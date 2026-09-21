// AI Gateway — the single server-side entry point for AI execution.
//
//   request → auth context → ownership → Workflow Router (Control Plane)
//           → quota check (read-only) → Dify Executor → stream back
//           → persist messages → record AI Run in activity_events
//
// It never trusts client-supplied workflow/model for execution and never
// returns secret material.

import { gatewayDb } from "./db.server";
import { executeDifyChat } from "./dify-executor.server";
import { GatewayError, isGatewayError } from "./errors";
import { sanitizeSecretText } from "./secrets.server";
import type { ThreadRecord } from "./types";
import { resolveWorkflow } from "./workflow-router.server";

export interface ChatRunInput {
  userId: string;
  threadId: string;
  message: string;
  /** Untrusted client hints — metadata / allow-listed routing only. */
  modelKey?: unknown;
  workflowKey?: unknown;
}

interface RunRecord {
  userId: string;
  projectId: string | null;
  threadId: string;
  workflowKey: string;
  executionTarget: string;
  status: "success" | "error";
  latencyMs: number;
  errorCode: string | null;
}

/** Best-effort AI Run log. Secrets are never included. */
async function recordRun(record: RunRecord): Promise<void> {
  try {
    await gatewayDb()
      .from("activity_events")
      .insert({
        type: "ai_run",
        title: `${record.workflowKey} · ${record.status === "success" ? "成功" : "失败"}`,
        actor_user_id: record.userId,
        metadata: {
          workflow: record.workflowKey,
          execution_target: record.executionTarget,
          status: record.status,
          latency_ms: record.latencyMs,
          project_id: record.projectId,
          thread_id: record.threadId,
          error: record.errorCode,
        },
      });
  } catch (err) {
    console.error("[ai-gateway] failed to record run", (err as Error).message);
  }
}

export async function runChat(input: ChatRunInput): Promise<Response> {
  const db = gatewayDb();
  const startedMs = Date.now();

  // 1. Ownership: the thread must belong to the caller.
  const { data: threadRow, error: threadError } = await db
    .from("threads")
    .select("*")
    .eq("id", input.threadId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (threadError) throw new GatewayError("DIFY_ERROR", threadError.message);
  if (!threadRow) throw new GatewayError("FORBIDDEN", "thread not found or not owned");
  const thread = threadRow as unknown as ThreadRecord;

  // 2. Workflow Router reads the Control Plane and returns an execution plan.
  const resolved = await resolveWorkflow({
    userId: input.userId,
    projectId: thread.project_id,
    threadId: thread.id,
    stage: thread.stage,
    workflowKey:
      typeof input.workflowKey === "string" && input.workflowKey.trim()
        ? input.workflowKey.trim()
        : null,
    modelKey: typeof input.modelKey === "string" ? input.modelKey : null,
  });

  // 3. Quota: read-only check. No token consumption, no fake counters.
  const quotaRes = await db
    .from("user_quotas")
    .select("token_limit, token_used")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (quotaRes.data) {
    const quota = quotaRes.data as unknown as {
      token_limit: number | null;
      token_used: number | null;
    };
    if (quota.token_limit != null && (quota.token_used ?? 0) >= quota.token_limit) {
      await recordRun({
        userId: input.userId,
        projectId: thread.project_id,
        threadId: thread.id,
        workflowKey: resolved.meta.workflowKey,
        executionTarget: resolved.meta.executionTarget,
        status: "error",
        latencyMs: Date.now() - startedMs,
        errorCode: "QUOTA_EXCEEDED",
      });
      throw new GatewayError("QUOTA_EXCEEDED");
    }
  }

  // 4. Persist the user message before execution (kept from the previous flow).
  const { error: insertUserError } = await db.from("messages").insert({
    thread_id: thread.id,
    user_id: input.userId,
    role: "user",
    content: input.message,
  });
  if (insertUserError) throw new GatewayError("DIFY_ERROR", insertUserError.message);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = "";
      let conversationId: string | null = null;
      let status: "success" | "error" = "success";
      let errorCode: string | null = null;

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
        if (!answer.trim()) {
          controller.enqueue(
            encoder.encode(
              "[提示] Dify 已连接，但本次没有返回任何回复内容，请检查该应用类型是否支持对话（chat/agent/chatflow）。",
            ),
          );
        }
      } catch (err) {
        status = "error";
        errorCode = isGatewayError(err) ? err.code : "DIFY_ERROR";
        const safe = sanitizeSecretText(err instanceof Error ? err.message : String(err), [
          resolved.target.apiKey,
        ]);
        console.error("[ai-gateway] dify run failed", errorCode, safe);
        controller.enqueue(
          encoder.encode(
            `\n\n[错误] ${isGatewayError(err) ? err.userMessage : "AI 服务返回错误，请重试。"}`,
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

        await recordRun({
          userId: input.userId,
          projectId: thread.project_id,
          threadId: thread.id,
          workflowKey: resolved.meta.workflowKey,
          executionTarget: resolved.meta.executionTarget,
          status,
          latencyMs: Date.now() - startedMs,
          errorCode,
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
