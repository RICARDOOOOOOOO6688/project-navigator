// Knowledge Provider Resolver — the single entry point for obtaining a provider.
//
// Business code must only ever call `getKnowledgeProvider()` and use the generic
// interface; it must not branch on provider names.
//
//   KNOWLEDGE_PROVIDER=none  → no-op provider (no network, returns [])
//   KNOWLEDGE_PROVIDER=sag   → SAG provider (config layer; API not implemented)
//   anything else            → clear KnowledgeError

import { KnowledgeError } from "./errors.server";
import { createSagProvider } from "./sag-provider.server";
import type { KnowledgeProvider } from "./types";

const NOOP_PROVIDER: KnowledgeProvider = {
  key: "none",
  async search() {
    return [];
  },
};

export function resolveKnowledgeProviderKey(): string {
  return (process.env["KNOWLEDGE_PROVIDER"] ?? "none").trim().toLowerCase() || "none";
}

export function getKnowledgeProvider(): KnowledgeProvider {
  const key = resolveKnowledgeProviderKey();
  switch (key) {
    case "none":
      return NOOP_PROVIDER;
    case "sag":
      return createSagProvider();
    default:
      throw new KnowledgeError("KNOWLEDGE_PROVIDER_UNSUPPORTED", `KNOWLEDGE_PROVIDER=${key}`);
  }
}
