import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { resolveModelRoute } from "@/lib/model-router.server";

// Proxies chat messages to the user's Dify Agent (streaming) and persists
// both sides of the conversation to the database.
export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.replace(/^Bearer\s+/i, "");
        if (!token) return new Response("Unauthorized", { status: 401 });

        const supabase = createClient(
          import.meta.env["VITE_SUPABASE_URL"]!,
          import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"]!,
          {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          },
        );
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();
        if (authError || !user) return new Response("Unauthorized", { status: 401 });

        const body = (await request.json()) as {
          threadId?: string;
          message?: string;
          model?: unknown;
        };
        if (!body.threadId || !body.message?.trim()) {
          return new Response("threadId and message are required", {
            status: 400,
          });
        }

        const { data: thread, error: threadError } = await supabase
          .from("threads")
          .select("*")
          .eq("id", body.threadId)
          .eq("user_id", user.id)
          .single();
        if (threadError || !thread) return new Response("Thread not found", { status: 404 });

        // Allowlist + route the requested ModelKey BEFORE persisting anything.
        const resolved = resolveModelRoute(body.model);
        if (!resolved.ok) {
          const status = resolved.code === "DIFY_NOT_CONFIGURED" ? 503 : 400;
          return new Response(JSON.stringify({ code: resolved.code, message: resolved.message }), {
            status,
            headers: { "Content-Type": "application/json" },
          });
        }
        const { baseUrl: difyBase, apiKey: difyKey } = resolved.route;

        const { error: insertUserError } = await supabase.from("messages").insert({
          thread_id: thread.id,
          user_id: user.id,
          role: "user",
          content: body.message,
        });
        if (insertUserError) return new Response(insertUserError.message, { status: 500 });

        const endpoint = `${difyBase}/chat-messages`;
        let difyRes: Response;
        try {
          difyRes = await fetch(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${difyKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              inputs: { stage: thread.stage },
              query: body.message,
              response_mode: "streaming",
              // Dify rejects an unknown id; only send one we previously stored.
              conversation_id: thread.dify_conversation_id ?? "",
              user: user.id,
            }),
          });
        } catch (err) {
          console.error("Dify fetch failed", endpoint, (err as Error).message);
          return new Response(`无法连接 Dify 服务（${endpoint}）：${(err as Error).message}`, {
            status: 502,
          });
        }

        if (!difyRes.ok || !difyRes.body) {
          const detail = await difyRes.text().catch(() => "");
          console.error("Dify request failed", difyRes.status, detail.slice(0, 500));
          return new Response(`Dify 请求失败（${difyRes.status}）：${detail.slice(0, 300)}`, {
            status: 502,
          });
        }

        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        const reader = difyRes.body.getReader();

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            let buffer = "";
            let fullAnswer = "";
            let conversationId: string | null = null;
            try {
              const handleLine = (line: string) => {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) return; // skip event:/id:/ping/blank
                const payload = trimmed.slice(5).trim();
                if (!payload || payload === "[DONE]") return;
                let event: Record<string, unknown>;
                try {
                  event = JSON.parse(payload);
                } catch {
                  return; // malformed chunk
                }
                if (typeof event["conversation_id"] === "string")
                  conversationId = event["conversation_id"];
                const name = event["event"];
                const answer = event["answer"];
                if (
                  (name === "message" || name === "agent_message" || name === "message_replace") &&
                  typeof answer === "string"
                ) {
                  if (name === "message_replace") fullAnswer = "";
                  fullAnswer += answer;
                  controller.enqueue(encoder.encode(answer));
                } else if (name === "error") {
                  const msg =
                    (event["message"] as string) ?? (event["code"] as string) ?? "未知错误";
                  console.error("Dify stream event error", msg);
                  controller.enqueue(encoder.encode(`\n\n[错误] ${msg}`));
                }
              };

              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";
                for (const line of lines) handleLine(line);
              }
              if (buffer.trim()) handleLine(buffer);
              if (!fullAnswer.trim()) {
                controller.enqueue(
                  encoder.encode(
                    "[提示] Dify 已连接，但本次没有返回任何回复内容，请检查该 Agent 的应用类型是否支持对话（chat/agent/chatflow）。",
                  ),
                );
              }
            } catch (err) {
              console.error("Dify stream error", err);
            } finally {
              try {
                if (fullAnswer.trim()) {
                  await supabase.from("messages").insert({
                    thread_id: thread.id,
                    user_id: user.id,
                    role: "assistant",
                    content: fullAnswer,
                  });
                }
                await supabase
                  .from("threads")
                  .update({
                    updated_at: new Date().toISOString(),
                    ...(conversationId ? { dify_conversation_id: conversationId } : {}),
                    ...(thread.title === "新项目" ? { title: body.message!.slice(0, 24) } : {}),
                  })
                  .eq("id", thread.id);
              } catch (err) {
                console.error("Failed to persist chat", err);
              }
              controller.close();
            }
          },
          cancel() {
            reader.cancel().catch(() => undefined);
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        });
      },
    },
  },
});
