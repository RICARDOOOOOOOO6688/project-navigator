// Knowledge Service — the stable call site for the rest of the app.
//
// Callers never touch SAG or any concrete provider; they only use this function.

import { getKnowledgeProvider } from "./knowledge-provider.server";
import type { KnowledgeSearchInput, KnowledgeSearchResult } from "./types";

const DEFAULT_TOP_K = 5;

export async function searchKnowledge(
  input: KnowledgeSearchInput,
): Promise<KnowledgeSearchResult[]> {
  const provider = getKnowledgeProvider();
  const topK = input.topK && input.topK > 0 ? input.topK : DEFAULT_TOP_K;
  return provider.search({ ...input, topK });
}
