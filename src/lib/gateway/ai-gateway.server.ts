// AI Gateway — the single server-side entry point for AI execution.
//
// Two modes:
//   dify   → Workflow Router (ai_workflows → ai_providers) → Dify Executor
//            (UNCHANGED; skills are never loaded here)
//   direct → ai_models → ai_providers → secret + project skills → OpenAI-compatible API
//
// No quota check, no activity_events. Tokens are written only when the provider
// actually reports usage; otherwise the token columns are omitted.

import { gatewayDb } from "./db.server";
import { executeDifyChat, type DifyUsage } from "./dify-executor.server";
import {
  executeDirectModel,
  type DirectMessage,
  type DirectUsage,
} from "./direct-model-executor.server";
import { GatewayError, isGatewayError } from "./errors";
import { resolveSecret, sanitizeSecretText } from "./secrets.server";
import { resolveProjectSkills } from "./skill-resolver.server";
import type { ThreadRecord } from "./types";
import { resolveWorkflow } from "./workflow-router.server";

export type ExecutionMode = "dify" | "direct";

export interface ChatRunInput {
  userId: string;
  threadId: string;
  message: string;
  /** Untrusted client hint; defaults to "dify". */
  executionMode?: unknown;
  /** Required for direct mode. */
  modelKey?: unknown;
  /** Optional allow-listed workflow key (dify mode). */
  workflowKey?: unknown;
}

const BASE_SYSTEM_INSTRUCTIONS = "你是一个专业、严谨、乐于助人的 AI 助手。";

function buildSystemInstructions(
  skills: { name: string; version: string; instructions: string }[],
): string {
  const parts = [BASE_SYSTEM_INSTRUCTIONS];
  for (const s of skills) {
    parts.push(`## 技能：${s.name}（v${s.version}）\n${s.instructions}`);
  }
  return parts.join("\n\n");
}

interface UsageRecord {
  userId: string;
  projectId: string | null;
  /** null for direct-mode runs (no workflow involved). */
  workflowKey: string | null;
  modelKey: string | null;
  providerKey: string | null;
  usage?: DifyUsage | DirectUsage;
}

async function recordUsage(record: UsageRecord): Promise<void> {
  try {
    await gatewayDb()
      .from("usage_events")
      .insert({
        user_id: record.userId,
        project_id: record.projectId,
        workflow_key: record.workflowKey,
        model_key: record.modelKey,
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

async function resolveDirectTarget(modelKey: string | null): Promise<{
  model: { key: string; name: string };
  provider: { key: string; name: string };
  apiKey: string;
  baseUrl: string;
}> {
  if (!modelKey) throw new GatewayError("MODEL_NOT_FOUND", "modelKey is required for direct mode");
  const db = gatewayDb();

  const mRes = await db
    .from("ai_models")
    .select("key, name, provider_key, enabled")
    .eq("key", modelKey)
    .maybeSingle();
  if (mRes.error) throw new GatewayError("MODEL_NOT_FOUND", mRes.error.message);
  if (!mRes.data) throw new GatewayError("MODEL_NOT_FOUND", `key=${modelKey}`);
  const model = mRes.data as unknown as {
    key: string;
    name: string;
    provider_key: string | null;
    enabled: boolean;
  };
  if (!model.enabled) throw new GatewayError("MODEL_DISABLED", model.key);
  if (!model.provider_key)
    throw new GatewayError("PROVIDER_NOT_FOUND", "model has no provider_key");

  const pRes = await db
    .from("ai_providers")
    .select("key, name, base_url, secret_ref, enabled")
    .eq("key", model.provider_key)
    .maybeSingle();
  if (pRes.error) throw new GatewayError("PROVIDER_NOT_FOUND", pRes.error.message);
  if (!pRes.data) throw new GatewayError("PROVIDER_NOT_FOUND", `key=${model.provider_key}`);
  const provider = pRes.data as unknown as {
    key: string;
    name: string;
    base_url: string | null;
    secret_ref: string | null;
    enabled: boolean;
  };
  if (!provider.enabled) throw new GatewayError("PROVIDER_DISABLED", provider.key);
  if (!provider.base_url?.trim()) {
    throw new GatewayError("PROVIDER_NOT_CONFIGURED", "provider has no base_url");
  }

  const secret = resolveSecret(provider.secret_ref);
  if (!secret.ok) throw new GatewayError("SECRET_NOT_CONFIGURED", secret.reason);

  return {
    model: { key: model.key, name: model.name },
    provider: { key: provider.key, name: provider.name },
    apiKey: secret.value,
    baseUrl: provider.base_url,
  };
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

  const mode: ExecutionMode = input.executionMode === "direct" ? "direct" : "dify";
  const encoder = new TextEncoder();

  // ---------------------------------------------------------------------------
  // DIFY MODE — unchanged. Skills are never loaded here.
  // ---------------------------------------------------------------------------
  if (mode === "dify") {
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

    const { error: insertUserError } = await db.from("messages").insert({
      thread_id: thread.id,
      user_id: input.userId,
      role: "user",
      content: input.message,
    });
    if (insertUserError) throw new GatewayError("DIFY_REQUEST_FAILED", insertUserError.message);

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
            modelKey: null,
            providerKey: resolved.provider.key,
            ...(usage ? { usage } : {}),
          });

          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
    });
  }

  // ---------------------------------------------------------------------------
  // DIRECT MODE — skills + OpenAI-compatible model. Dify is not involved.
  // ---------------------------------------------------------------------------
  const modelKey =
    typeof input.modelKey === "string" && input.modelKey.trim() ? input.modelKey.trim() : null;
  const target = await resolveDirectTarget(modelKey);

  const { error: insertUserError } = await db.from("messages").insert({
    thread_id: thread.id,
    user_id: input.userId,
    role: "user",
    content: input.message,
  });
  if (insertUserError)
    throw new GatewayError("DIRECT_MODEL_REQUEST_FAILED", insertUserError.message);

  // Skills: only enabled ones, ordered by project_skills.sort_order.
  const skills = await resolveProjectSkills(thread.project_id);
  const system = buildSystemInstructions(skills);

  // Conversation history (includes the just-inserted user message).
  const historyRes = await db
    .from("messages")
    .select("role, content")
    .eq("thread_id", thread.id)
    .order("created_at", { ascending: true })
    .limit(50);
  const history = (historyRes.data ?? []) as unknown as { role: string; content: string }[];
  const messages: DirectMessage[] = [{ role: "system", content: system }];
  for (const m of history) {
    if (m.role === "user" || m.role === "assistant") {
      messages.push({ role: m.role, content: m.content });
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = "";
      let usage: DirectUsage | undefined;

      try {
        const result = await executeDirectModel(
          {
            baseUrl: target.baseUrl,
            apiKey: target.apiKey,
            model: target.model.key,
            messages,
          },
          (delta) => {
            answer += delta;
            controller.enqueue(encoder.encode(delta));
          },
        );
        usage = result.usage;
        if (!answer.trim()) {
          controller.enqueue(encoder.encode("[提示] 模型已连接，但本次没有返回任何内容。"));
        }
      } catch (err) {
        const safe = sanitizeSecretText(err instanceof Error ? err.message : String(err), [
          target.apiKey,
        ]);
        const code = isGatewayError(err) ? err.code : "DIRECT_MODEL_REQUEST_FAILED";
        console.error("[ai-gateway] direct model run failed", code, safe);
        controller.enqueue(
          encoder.encode(
            `\n\n[错误] ${isGatewayError(err) ? err.userMessage : "模型服务请求失败，请稍后重试。"}`,
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
              ...(thread.title === "新项目" ? { title: input.message.slice(0, 24) } : {}),
            })
            .eq("id", thread.id);
        } catch (err) {
          console.error("[ai-gateway] persist failed", (err as Error).message);
        }

        await recordUsage({
          userId: input.userId,
          projectId: thread.project_id,
          workflowKey: null,
          modelKey: target.model.key,
          providerKey: target.provider.key,
          ...(usage ? { usage } : {}),
        });

        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
