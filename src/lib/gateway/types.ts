// Shared gateway types, aligned with the authoritative ai_* control plane.
// `apiKey` lives only on the internal execution plan and never crosses back.

export interface ThreadRecord {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  stage: string | null;
  dify_conversation_id: string | null;
}

/** public.ai_workflows */
export interface WorkflowRecord {
  id: string;
  key: string;
  name: string;
  description: string;
  secret_ref: string | null;
  provider_key: string | null;
  enabled: boolean;
  sort_order: number;
}

/** public.ai_providers */
export interface ProviderRecord {
  id: string;
  key: string;
  name: string;
  description: string;
  base_url: string | null;
  secret_ref: string | null;
  enabled: boolean;
}

export interface ResolveContext {
  userId: string;
  projectId: string | null;
  threadId: string;
  stage: string | null;
  /** Client may request a known workflow key; the server still resolves it. */
  workflowKey?: string | null;
}

export interface ExecutionPlan {
  workflow: { id: string; key: string; name: string };
  provider: { id: string; key: string; name: string; baseUrl: string };
  target: {
    /** Dify base URL (never returned to the client). */
    baseUrl: string;
    /** SECRET — server-side only, never returned or logged. */
    apiKey: string;
  };
  meta: {
    workflowKey: string;
    stage: string | null;
    executionTarget: "dify";
  };
}
