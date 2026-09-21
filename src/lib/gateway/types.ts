// Shared gateway types. Safe metadata only — `apiKey` lives on the internal
// execution plan and never crosses back to the client.

export interface ThreadRecord {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  stage: string | null;
  dify_conversation_id: string | null;
}

export interface WorkflowRecord {
  id: string;
  key: string;
  label: string;
  dify_app_id: string | null;
  app_type: "workflow" | "chatflow";
  secret_ref: string | null;
  secret_source: string;
  enabled: boolean;
}

export interface ModelRecord {
  model_key: string;
  display_name: string;
  enabled: boolean;
}

export interface ResolveContext {
  userId: string;
  projectId: string | null;
  threadId: string;
  stage: string | null;
  /** Client may request a known workflow key; the server still resolves it. */
  workflowKey?: string | null;
  /** Metadata only in this phase — Dify decides the actual model. */
  modelKey?: string | null;
}

export interface ExecutionPlan {
  workflow: {
    id: string;
    key: string;
    label: string;
    app_type: string;
    dify_app_id: string;
  };
  target: {
    kind: "dify";
    /** Dify base URL (never returned to the client). */
    baseUrl: string;
    appId: string;
    /** SECRET — server-side only, never returned or logged. */
    apiKey: string;
  };
  /** Informational; the model is not called directly in this phase. */
  model: { key: string; displayName: string } | null;
  meta: {
    workflowKey: string;
    stage: string | null;
    appType: string;
    executionTarget: "dify";
  };
}
