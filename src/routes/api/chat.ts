import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

import { runChat } from "@/lib/gateway/ai-gateway.server";
import { isGatewayError } from "@/lib/gateway/errors";

// Thin transport layer: parse → authenticate → AI Gateway → return.
// All workflow routing, Dify execution, persistence and run recording live in
// the gateway (src/lib/gateway/*).

function jsonError(code: string, message: string, status: number) {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.replace(/^Bearer\s+/i, "");
        if (!token) return jsonError("AUTH_REQUIRED", "请先登录。", 401);

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
        if (authError || !user) return jsonError("AUTH_REQUIRED", "请先登录。", 401);

        let body: { threadId?: string; message?: string; model?: unknown; workflowKey?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return jsonError("FORBIDDEN", "请求格式无效。", 400);
        }
        if (!body.threadId || !body.message?.trim()) {
          return jsonError("FORBIDDEN", "threadId 与 message 为必填。", 400);
        }

        try {
          return await runChat({
            userId: user.id,
            threadId: body.threadId,
            message: body.message.trim(),
            modelKey: body.model,
            workflowKey: body.workflowKey,
          });
        } catch (err) {
          if (isGatewayError(err)) {
            return jsonError(err.code, err.userMessage, err.httpStatus);
          }
          console.error("[api/chat] unexpected error", (err as Error).message);
          return jsonError("DIFY_REQUEST_FAILED", "AI 服务请求失败，请稍后重试。", 502);
        }
      },
    },
  },
});
