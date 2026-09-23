// Direct Model Executor (server-only) — OpenAI-compatible Chat Completions.
//
// Used only in Direct Model mode. Dify is never called from here.
// Skills are injected as system instructions by the caller (ai-gateway).

import { normalizeBaseUrl } from "./dify-executor.server";
import { GatewayError } from "./errors";
import { sanitizeSecretText } from "./secrets.server";

export interface DirectMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DirectRunInput {
  baseUrl: string;
  apiKey: string;
  /** Value sent as the API `model` (v1: ai_models.key). */
  model: string;
  messages: DirectMessage[];
  timeoutMs?: number;
}

export interface DirectUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface DirectRunResult {
  answer: string;
  /** Only set when the API actually returned usage. Never fabricated. */
  usage?: DirectUsage;
}

function resolveTimeoutMs(override?: number): number {
  if (typeof override === "number" && override > 0) return override;
  const raw = Number(process.env["DIRECT_MODEL_TIMEOUT_MS"]);
  return Number.isFinite(raw) && raw > 0 ? raw : 600_000;
}

export async function executeDirectModel(
  input: DirectRunInput,
  onDelta: (delta: string) => void,
): Promise<DirectRunResult> {
  const endpoint = `${normalizeBaseUrl(input.baseUrl)}/chat/completions`;
  const timeoutMs = resolveTimeoutMs(input.timeoutMs);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (timedOut) throw new GatewayError("DIRECT_MODEL_TIMEOUT", "connect timeout");
    throw new GatewayError(
      "DIRECT_MODEL_REQUEST_FAILED",
      sanitizeSecretText((err as Error).message, [input.apiKey]),
    );
  }

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    clearTimeout(timer);
    throw new GatewayError(
      "DIRECT_MODEL_REQUEST_FAILED",
      sanitizeSecretText(`HTTP ${res.status} ${detail.slice(0, 300)}`, [input.apiKey]),
    );
  }

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = "";
  let answer = "";
  let sawEvent = false;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }
    sawEvent = true;

    const usage = event["usage"] as
      { prompt_tokens?: unknown; completion_tokens?: unknown } | undefined;
    if (usage && typeof usage === "object") {
      if (typeof usage.prompt_tokens === "number") inputTokens = usage.prompt_tokens;
      if (typeof usage.completion_tokens === "number") outputTokens = usage.completion_tokens;
    }

    const choices = event["choices"];
    if (Array.isArray(choices) && choices.length > 0) {
      const delta = (choices[0] as { delta?: { content?: unknown } })?.delta;
      const content = delta?.content;
      if (typeof content === "string" && content.length > 0) {
        answer += content;
        onDelta(content);
      }
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    }
    if (buffer.trim()) handleLine(buffer);
  } catch (err) {
    if (timedOut) throw new GatewayError("DIRECT_MODEL_TIMEOUT", "stream timeout");
    throw new GatewayError(
      "DIRECT_MODEL_REQUEST_FAILED",
      sanitizeSecretText((err as Error).message, [input.apiKey]),
    );
  } finally {
    clearTimeout(timer);
  }

  if (!sawEvent) throw new GatewayError("DIRECT_MODEL_RESPONSE_INVALID", "no SSE data events");

  const usage: DirectUsage = {};
  if (inputTokens !== undefined) usage.inputTokens = inputTokens;
  if (outputTokens !== undefined) usage.outputTokens = outputTokens;

  return {
    answer,
    ...(inputTokens !== undefined || outputTokens !== undefined ? { usage } : {}),
  };
}
