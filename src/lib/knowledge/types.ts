// Knowledge Provider abstraction — the single, generic shape the rest of the
// app depends on. SAG-specific fields must never leak past this boundary.
//
// There is intentionally NO concrete backend wired up yet: the default provider
// is `none` and never issues a network request.

export interface KnowledgeSearchInput {
  query: string;
  /** Optional project scope for future per-project knowledge. */
  projectId?: string;
  /** Max results to return. */
  topK?: number;
}

export interface KnowledgeSearchResult {
  id: string;
  title: string;
  content: string;
  source?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeProvider {
  /** Provider key, e.g. "none" or "sag". */
  readonly key: string;
  search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult[]>;
}
