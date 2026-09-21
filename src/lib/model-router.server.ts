// Server-only model routing layer.
//
//   client sends ModelKey  ->  allowlist check  ->  ModelRoute  ->  provider call
//
// The browser never names a provider, endpoint, model id or key; it only sends
// one of the abstract ModelKey values. This module is the single place where a
// ModelKey is resolved into a concrete backend target.

import { DEFAULT_MODEL_KEY, isModelKey, type ModelKey } from "./models";

export type DifyRoute = {
  provider: "dify";
  /** Base URL of the Dify instance, no trailing slash. */
  baseUrl: string;
  apiKey: string;
};

/** Future providers get their own variant here (e.g. { provider: "openai"; model: string }). */
export type ModelRoute = DifyRoute;

export type ResolveResult =
  | { ok: true; modelKey: ModelKey; route: ModelRoute }
  | {
      ok: false;
      modelKey: ModelKey;
      code: "MODEL_NOT_ALLOWED" | "MODEL_NOT_ENABLED" | "DIFY_NOT_CONFIGURED";
      message: string;
    };

function readDifyConfig(): { baseUrl: string; apiKey: string | null } {
  const apiKey = process.env["DIFY_API_KEY"]?.trim() || null;
  const baseUrl = (
    process.env["DIFY_API_BASE"] ??
    process.env["DIFY_API_URL"] ??
    "https://api.dify.ai/v1"
  )
    .trim()
    .replace(/\/+$/, "");
  return { baseUrl, apiKey };
}

/**
 * Allowlist + routing. `raw` is untrusted input straight off the request body.
 */
export function resolveModelRoute(raw: unknown): ResolveResult {
  // 1. Allowlist: anything that is not a known ModelKey is rejected outright.
  if (raw !== undefined && raw !== null && raw !== "" && !isModelKey(raw)) {
    return {
      ok: false,
      modelKey: DEFAULT_MODEL_KEY,
      code: "MODEL_NOT_ALLOWED",
      message: "不支持的模型选项。",
    };
  }
  const modelKey: ModelKey = isModelKey(raw) ? raw : DEFAULT_MODEL_KEY;

  // 2. Routing: only `default` has a real backend today.
  if (modelKey !== "default") {
    return {
      ok: false,
      modelKey,
      code: "MODEL_NOT_ENABLED",
      message: "该模型尚未接入，请先使用「默认总管」。",
    };
  }

  const { baseUrl, apiKey } = readDifyConfig();
  if (!apiKey) {
    return {
      ok: false,
      modelKey,
      code: "DIFY_NOT_CONFIGURED",
      message: "尚未配置 Dify Agent 密钥。",
    };
  }

  return { ok: true, modelKey, route: { provider: "dify", baseUrl, apiKey } };
}
