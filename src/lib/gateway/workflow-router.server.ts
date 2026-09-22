// Workflow Router — turns a request context into a concrete execution plan by
// reading the authoritative control plane:
//
//   ai_workflows (by key)  →  ai_providers (by provider_key)  →  secret_ref
//
// No silent fallback: missing / disabled / unconfigured records and an
// unresolvable secret are explicit GatewayErrors. The client never supplies the
// provider, base URL or secret — only an optional allow-listed workflow key.

import { gatewayDb } from "./db.server";
import { GatewayError } from "./errors";
import { resolveSecret } from "./secrets.server";
import { isKnownWorkflowKey, workflowKeyForStage } from "./stage-workflow-map";
import type { ExecutionPlan, ProviderRecord, ResolveContext, WorkflowRecord } from "./types";

export async function resolveWorkflow(ctx: ResolveContext): Promise<ExecutionPlan> {
  // 1. Server decides the workflow key; a client key must be allow-listed.
  let workflowKey: string;
  if (ctx.workflowKey) {
    if (!isKnownWorkflowKey(ctx.workflowKey)) {
      throw new GatewayError("WORKFLOW_NOT_FOUND", `unknown workflowKey=${ctx.workflowKey}`);
    }
    workflowKey = ctx.workflowKey;
  } else {
    workflowKey = workflowKeyForStage(ctx.stage);
  }

  const db = gatewayDb();

  // 2. Workflow record from ai_workflows.
  const wfRes = await db.from("ai_workflows").select("*").eq("key", workflowKey).maybeSingle();
  if (wfRes.error) throw new GatewayError("WORKFLOW_NOT_FOUND", wfRes.error.message);
  if (!wfRes.data) throw new GatewayError("WORKFLOW_NOT_FOUND", `key=${workflowKey}`);
  const workflow = wfRes.data as unknown as WorkflowRecord;

  if (!workflow.enabled) throw new GatewayError("WORKFLOW_DISABLED", `key=${workflow.key}`);
  if (!workflow.provider_key?.trim()) {
    throw new GatewayError("PROVIDER_NOT_FOUND", "workflow has no provider_key");
  }

  // 3. Provider record from ai_providers via the logical provider_key link.
  const pvRes = await db
    .from("ai_providers")
    .select("*")
    .eq("key", workflow.provider_key)
    .maybeSingle();
  if (pvRes.error) throw new GatewayError("PROVIDER_NOT_FOUND", pvRes.error.message);
  if (!pvRes.data) throw new GatewayError("PROVIDER_NOT_FOUND", `key=${workflow.provider_key}`);
  const provider = pvRes.data as unknown as ProviderRecord;

  if (!provider.enabled) throw new GatewayError("PROVIDER_DISABLED", `key=${provider.key}`);
  if (!provider.base_url?.trim()) {
    throw new GatewayError("PROVIDER_NOT_CONFIGURED", "provider has no base_url");
  }

  // 4. Secret: workflow secret_ref first, then provider secret_ref.
  const ref = workflow.secret_ref?.trim() || provider.secret_ref?.trim() || null;
  const secret = resolveSecret(ref);
  if (!secret.ok) throw new GatewayError("SECRET_NOT_CONFIGURED", secret.reason);

  return {
    workflow: { id: workflow.id, key: workflow.key, name: workflow.name },
    provider: {
      id: provider.id,
      key: provider.key,
      name: provider.name,
      baseUrl: provider.base_url,
    },
    target: { baseUrl: provider.base_url, apiKey: secret.value },
    meta: {
      workflowKey: workflow.key,
      stage: ctx.stage,
      executionTarget: "dify",
    },
  };
}
