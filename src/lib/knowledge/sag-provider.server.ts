// SAG Knowledge Provider — configuration layer only.
//
// NOT implemented yet on purpose: the official SAG search API (endpoint path,
// request/response shape, auth header, citation format) is not defined, so this
// module performs config validation and returns a clear error. It never sends an
// HTTP request and never guesses an endpoint.

import { KnowledgeError } from "./errors.server";
import type { KnowledgeProvider, KnowledgeSearchInput, KnowledgeSearchResult } from "./types";

export interface SagConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

/** Read + validate SAG configuration from the server environment. */
export function readSagConfig(): SagConfig {
  const baseUrl = process.env["SAG_BASE_URL"]?.trim();
  if (!baseUrl) {
    throw new KnowledgeError("KNOWLEDGE_PROVIDER_NOT_CONFIGURED", "missing SAG_BASE_URL");
  }
  const apiKey = process.env["SAG_API_KEY"]?.trim();
  if (!apiKey) {
    throw new KnowledgeError("KNOWLEDGE_PROVIDER_NOT_CONFIGURED", "missing SAG_API_KEY");
  }
  const raw = Number(process.env["SAG_TIMEOUT_MS"]);
  const timeoutMs = Number.isFinite(raw) && raw > 0 ? raw : 10_000;
  return { baseUrl, apiKey, timeoutMs };
}

export function createSagProvider(): KnowledgeProvider {
  return {
    key: "sag",
    async search(_input: KnowledgeSearchInput): Promise<KnowledgeSearchResult[]> {
      // Validate config so misconfiguration fails loudly and early.
      readSagConfig();

      // TODO(SAG): call the official SAG search API here once confirmed:
      //   - endpoint path + method
      //   - request body (query, topK, project scope)
      //   - auth header (Bearer SAG_API_KEY) and timeout (SAG_TIMEOUT_MS)
      //   - response mapping → KnowledgeSearchResult[]
      //   - citation/source mapping
      // Until then, fail explicitly rather than fabricate results.
      throw new KnowledgeError(
        "KNOWLEDGE_PROVIDER_NOT_CONFIGURED",
        "SAG provider not implemented yet (awaiting official API)",
      );
    },
  };
}
