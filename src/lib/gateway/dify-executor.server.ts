// Dify Executor — the only place that talks to Dify.
//
// Responsibilities: attach the secret, POST /chat-messages in streaming mode,
// parse the SSE stream, forward deltas, track conversation_id, normalize HTTP /
// network / timeout failures into GatewayError, and sanitize error text.

import { GatewayError } from "./errors";
import { sanitizeSecretText } from "./secrets.server";

const DEFAULT_TIMEOUT_MS = 120_000;

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

export interface DifyRunResult {
  answer: string;
  conversationId: string | null;
}

export async function executeDifyChat(
  input: DifyRunInput,
  onDelta: (delta: string) => void,
): Promise<DifyRunResult> {
  const endpoint = `${input.baseUrl.replace(/\/+$/, "")}/chat-messages`;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

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
      "DIFY_UNAVAILABLE",
      sanitizeSecretText((err as Error).message, [input.apiKey]),
    );
  }

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    clearTimeout(timer);
    throw new GatewayError(
      "DIFY_ERROR",
      sanitizeSecretText(`HTTP ${res.status} ${detail.slice(0, 300)}`, [input.apiKey]),
    );
  }

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = "";
  let answer = "";
  let conversationId: string | null = null;

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
    } else if (name === "error") {
      const msg = (event["message"] as string) ?? (event["code"] as string) ?? "unknown error";
      throw new GatewayError("DIFY_ERROR", sanitizeSecretText(msg, [input.apiKey]));
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
      "DIFY_ERROR",
      sanitizeSecretText((err as Error).message, [input.apiKey]),
    );
  } finally {
    clearTimeout(timer);
  }

  return { answer, conversationId };
}
