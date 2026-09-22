// AI Gateway — the single server-side entry point for AI execution.
//
//   request → auth context → ownership → Workflow Router (ai_workflows → ai_providers)
//           → Dify Executor → stream back → persist messages
//           → record the run in usage_events
//
// No quota check, no activity_events. Tokens are written only when Dify actually
// reports usage; otherwise the token columns are omitted (never fabricated).

import { gatewayDb } from "./db.server";
import { executeDifyChat, type DifyUsage } from "./dify-executor.server";
import { GatewayError, isGatewayError } from "./errors";
import { sanitizeSecretText } from "./secrets.server";
import type { ThreadRecord } from "./types";
import { resolveWorkflow } from "./workflow-router.server";

export interface ChatRunInput {
  userId: string;
  threadId: string;
  message: string;
  /** Untrusted client hints. Not used for routing; kept for future use. */
  modelKey?: unknown;
  workflowKey?: unknown;
}

interface UsageRecord {
  userId: string;
  projectId: string | null;
  workflowKey: string;
  providerKey: string;
  usage?: DifyUsage;
}

/**
 * Append a run row to usage_events using only the columns that exist:
 * user_id, project_id, workflow_key, model_key, provider_key,
 * input_tokens, output_tokens, created_at.
 *
 * model_key is always null (ai_models is a catalog and does not drive execution).
 * input_tokens / output_tokens are included only when Dify reported them; if
 * omitted the column default (0) applies — that 0 means "not measured".
 */
async function recordUsage(record: UsageRecord): Promise<void> {
  try {
    await gatewayDb()
      .from("usage_events")
      .insert({
        user_id: record.userId,
        project_id: record.projectId,
        workflow_key: record.workflowKey,
        model_key: null,
        provider_key: record.providerKey,
        ...(record.usage?.inputTokens !== undefined
          ? { input_tokens: record.usage.inputTokens }
          : {}),
        ...(record.usage?.outputTokens !== undefined
          ? { output_tokens: record.usage.outputTokens }
          : {}),
      });
  } catch (err) {
    console.error("[ai-gateway] failed to record usage", (err as Error).message);
  }
}

export async function runChat(input: ChatRunInput): Promise<Response> {
  const db = gatewayDb();

  // 1. Ownership: the thread must belong to the caller.
  const { data: threadRow, error: threadError } = await db
    .from("threads")
    .select("*")
    .eq("id", input.threadId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (threadError) throw new GatewayError("DIFY_REQUEST_FAILED", threadError.message);
  if (!threadRow) throw new GatewayError("FORBIDDEN", "thread not found or not owned");
  const thread = threadRow as unknown as ThreadRecord;

  // 2. Workflow Router reads ai_workflows → ai_providers and resolves the secret.
  const resolved = await resolveWorkflow({
    userId: input.userId,
    projectId: thread.project_id,
    threadId: thread.id,
    stage: thread.stage,
    workflowKey:
      typeof input.workflowKey === "string" && input.workflowKey.trim()
        ? input.workflowKey.trim()
        : null,
  });

  // 3. Persist the user message before execution.
  const { error: insertUserError } = await db.from("messages").insert({
    thread_id: thread.id,
    user_id: input.userId,
    role: "user",
    content: input.message,
  });
  if (insertUserError) throw new GatewayError("DIFY_REQUEST_FAILED", insertUserError.message);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = "";
      let conversationId: string | null = null;
      let usage: DifyUsage | undefined;

      try {
        const result = await executeDifyChat(
          {
            baseUrl: resolved.target.baseUrl,
            apiKey: resolved.target.apiKey,
            query: input.message,
            userId: input.userId,
            conversationId: thread.dify_conversation_id,
            inputs: {
              stage: thread.stage,
              project_id: thread.project_id,
              thread_id: thread.id,
            },
          },
          (delta) => {
            answer += delta;
            controller.enqueue(encoder.encode(delta));
          },
        );
        conversationId = result.conversationId;
        usage = result.usage;
        if (!answer.trim()) {
          controller.enqueue(
            encoder.encode(
              "[提示] Dify 已连接，但本次没有返回任何回复内容，请检查该应用类型是否支持对话（chat/agent/chatflow）。",
            ),
          );
        }
      } catch (err) {
        const safe = sanitizeSecretText(err instanceof Error ? err.message : String(err), [
          resolved.target.apiKey,
        ]);
        const code = isGatewayError(err) ? err.code : "DIFY_REQUEST_FAILED";
        console.error("[ai-gateway] dify run failed", code, safe);
        controller.enqueue(
          encoder.encode(
            `\n\n[错误] ${isGatewayError(err) ? err.userMessage : "AI 服务请求失败，请稍后重试。"}`,
          ),
        );
      } finally {
        try {
          if (answer.trim()) {
            await db.from("messages").insert({
              thread_id: thread.id,
              user_id: input.userId,
              role: "assistant",
              content: answer,
            });
          }
          await db
            .from("threads")
            .update({
              updated_at: new Date().toISOString(),
              ...(conversationId ? { dify_conversation_id: conversationId } : {}),
              ...(thread.title === "新项目" ? { title: input.message.slice(0, 24) } : {}),
            })
            .eq("id", thread.id);
        } catch (err) {
          console.error("[ai-gateway] persist failed", (err as Error).message);
        }

        await recordUsage({
          userId: input.userId,
          projectId: thread.project_id,
          workflowKey: resolved.meta.workflowKey,
          providerKey: resolved.provider.key,
          ...(usage ? { usage } : {}),
        });

        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
