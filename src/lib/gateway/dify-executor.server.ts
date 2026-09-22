// Dify Executor — the only place that talks to Dify.
//
// Responsibilities: normalize the provider base URL, POST /chat-messages in
// streaming mode, parse the SSE stream, forward deltas, track conversation_id,
// capture usage when present, and normalize HTTP / network / timeout / malformed
// failures into GatewayError with sanitized text.

import { GatewayError } from "./errors";
import { sanitizeSecretText } from "./secrets.server";

// Local/self-hosted models can be slow. Default 10 minutes; override with the
// optional DIFY_TIMEOUT_MS env var (no restart needed for requests, but env
// changes still require a dev-server restart).
function resolveTimeoutMs(override?: number): number {
  if (typeof override === "number" && override > 0) return override;
  const raw = Number(process.env["DIFY_TIMEOUT_MS"]);
  return Number.isFinite(raw) && raw > 0 ? raw : 600_000;
}

export interface DifyRunInput {
  baseUrl: string;
  apiKey: string;
  query: string;
  userId: string;
  conversationId: string | null;
  inputs: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface DifyUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface DifyRunResult {
  answer: string;
  conversationId: string | null;
  /** Only set when Dify actually reported usage. Never fabricated. */
  usage?: DifyUsage;
}

/**
 * Normalize a provider base URL:
 *   - strip trailing slashes
 *   - empty or "/" path → append /v1
 *   - already ending in /v1 → left as is
 * e.g. https://api.dify.ai    → https://api.dify.ai/v1
 *      https://api.dify.ai/v1 → https://api.dify.ai/v1
 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  try {
    const u = new URL(trimmed);
    if (u.pathname === "" || u.pathname === "/") return `${u.origin}/v1`;
    return trimmed;
  } catch {
    return trimmed;
  }
}

export async function executeDifyChat(
  input: DifyRunInput,
  onDelta: (delta: string) => void,
): Promise<DifyRunResult> {
  const endpoint = `${normalizeBaseUrl(input.baseUrl)}/chat-messages`;
  const timeoutMs = resolveTimeoutMs(input.timeoutMs);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  if (input.signal) {
    if (input.signal.aborted) controller.abort();
    else input.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: input.inputs,
        query: input.query,
        response_mode: "streaming",
        // Dify rejects an unknown id, so only send one we previously stored.
        conversation_id: input.conversationId ?? "",
        user: input.userId,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (timedOut) throw new GatewayError("DIFY_TIMEOUT", "connect timeout");
    throw new GatewayError(
      "DIFY_REQUEST_FAILED",
      sanitizeSecretText((err as Error).message, [input.apiKey]),
    );
  }

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    clearTimeout(timer);
    throw new GatewayError(
      "DIFY_REQUEST_FAILED",
      sanitizeSecretText(`HTTP ${res.status} ${detail.slice(0, 300)}`, [input.apiKey]),
    );
  }

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = "";
  let answer = "";
  let conversationId: string | null = null;
  let sawEvent = false;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  const handleLine = (line: string): void => {
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
    sawEvent = true;
    if (typeof event["conversation_id"] === "string") conversationId = event["conversation_id"];

    const name = event["event"];
    const delta = event["answer"];
    if (
      (name === "message" || name === "agent_message" || name === "message_replace") &&
      typeof delta === "string"
    ) {
      if (name === "message_replace") answer = "";
      answer += delta;
      onDelta(delta);
    } else if (name === "message_end") {
      const metadata = event["metadata"] as
        { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } } | undefined;
      const usage = metadata?.usage;
      if (usage && typeof usage === "object") {
        if (typeof usage.prompt_tokens === "number") inputTokens = usage.prompt_tokens;
        if (typeof usage.completion_tokens === "number") outputTokens = usage.completion_tokens;
      }
    } else if (name === "error") {
      const msg = (event["message"] as string) ?? (event["code"] as string) ?? "unknown error";
      throw new GatewayError("DIFY_REQUEST_FAILED", sanitizeSecretText(msg, [input.apiKey]));
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
    if (timedOut) throw new GatewayError("DIFY_TIMEOUT", "stream timeout");
    if (err instanceof GatewayError) throw err;
    throw new GatewayError(
      "DIFY_REQUEST_FAILED",
      sanitizeSecretText((err as Error).message, [input.apiKey]),
    );
  } finally {
    clearTimeout(timer);
  }

  if (!sawEvent) {
    throw new GatewayError("DIFY_RESPONSE_INVALID", "no SSE data events");
  }

  const usage: DifyUsage = {};
  if (inputTokens !== undefined) usage.inputTokens = inputTokens;
  if (outputTokens !== undefined) usage.outputTokens = outputTokens;

  return {
    answer,
    conversationId,
    ...(inputTokens !== undefined || outputTokens !== undefined ? { usage } : {}),
  };
}
