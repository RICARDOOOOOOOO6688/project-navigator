// Workflow Router — turns a request context into a concrete execution plan by
// reading the Control Plane (Supabase `workflows`, optional `models`).
//
// No silent fallback: a missing / disabled / unconfigured workflow, or an
// unresolvable secret, is an explicit GatewayError. The client never supplies
// the Dify App ID or secret — only an optional allow-listed workflow key.

import { gatewayDb } from "./db.server";
import { GatewayError } from "./errors";
import { resolveSecret } from "./secrets.server";
import { isKnownWorkflowKey, workflowKeyForStage } from "./stage-workflow-map";
import type { ExecutionPlan, ModelRecord, ResolveContext, WorkflowRecord } from "./types";

function difyBaseUrl(): string {
  return (
    process.env["DIFY_API_BASE"] ??
    process.env["DIFY_API_URL"] ??
    "https://api.dify.ai/v1"
  ).replace(/\/+$/, "");
}

export async function resolveWorkflow(ctx: ResolveContext): Promise<ExecutionPlan> {
  // 1. Server decides the workflow key. A client-supplied key must be allow-listed.
  let workflowKey: string;
  if (ctx.workflowKey) {
    if (!isKnownWorkflowKey(ctx.workflowKey)) {
      throw new GatewayError("WORKFLOW_NOT_FOUND", `unknown workflowKey=${ctx.workflowKey}`);
    }
    workflowKey = ctx.workflowKey;
  } else {
    workflowKey = workflowKeyForStage(ctx.stage);
  }

  // 2. Load the workflow record from the control plane.
  const db = gatewayDb();
  const { data, error } = await db
    .from("workflows")
    .select("*")
    .eq("key", workflowKey)
    .maybeSingle();
  if (error) throw new GatewayError("WORKFLOW_NOT_FOUND", error.message);
  if (!data) throw new GatewayError("WORKFLOW_NOT_FOUND", `key=${workflowKey}`);
  const workflow = data as unknown as WorkflowRecord;

  // 3. Explicit configuration gates — never fall back to a fake workflow.
  if (!workflow.enabled) throw new GatewayError("WORKFLOW_DISABLED", `key=${workflow.key}`);
  if (!workflow.dify_app_id?.trim()) {
    throw new GatewayError("WORKFLOW_NOT_CONFIGURED", "missing dify_app_id");
  }
  if (!workflow.secret_ref?.trim()) {
    throw new GatewayError("SECRET_NOT_CONFIGURED", "missing secret_ref");
  }

  const secret = resolveSecret(workflow.secret_ref, workflow.secret_source);
  if (!secret.ok) throw new GatewayError("SECRET_NOT_CONFIGURED", secret.reason);

  // 4. Optional model metadata. The model is NOT called in this phase; Dify
  //    decides the underlying model. An unknown key is simply not attached.
  let model: ExecutionPlan["model"] = null;
  if (ctx.modelKey && ctx.modelKey !== "default") {
    const res = await db
      .from("models")
      .select("model_key, display_name, enabled")
      .eq("model_key", ctx.modelKey)
      .maybeSingle();
    if (res.data) {
      const rec = res.data as unknown as ModelRecord;
      model = { key: rec.model_key, displayName: rec.display_name };
    }
  }

  return {
    workflow: {
      id: workflow.id,
      key: workflow.key,
      label: workflow.label,
      app_type: workflow.app_type,
      dify_app_id: workflow.dify_app_id,
    },
    target: {
      kind: "dify",
      baseUrl: difyBaseUrl(),
      appId: workflow.dify_app_id,
      apiKey: secret.value,
    },
    model,
    meta: {
      workflowKey: workflow.key,
      stage: ctx.stage,
      appType: workflow.app_type,
      executionTarget: "dify",
    },
  };
}
