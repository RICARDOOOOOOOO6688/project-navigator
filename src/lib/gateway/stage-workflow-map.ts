// Central stage → workflow mapping for the AI Gateway.
//
// Navigator stages:      idea | research | project | architecture | build
// Control-plane workflows: research | product | architecture | build
//
// NOTE: Navigator has no "product" stage and the control plane has no
// "project" workflow, so `project → product` is the current best-effort bridge.
// If the product design says otherwise, change it here — nowhere else.

export const DEFAULT_WORKFLOW_KEY = "research";

/** Workflow keys the client is allowed to request. */
export const KNOWN_WORKFLOW_KEYS = ["research", "product", "architecture", "build"] as const;
export type WorkflowKey = (typeof KNOWN_WORKFLOW_KEYS)[number];

const STAGE_TO_WORKFLOW: Record<string, string> = {
  idea: "research",
  research: "research",
  project: "product",
  architecture: "architecture",
  build: "build",
};

export function workflowKeyForStage(stage: string | null | undefined): string {
  if (stage && STAGE_TO_WORKFLOW[stage]) return STAGE_TO_WORKFLOW[stage];
  return DEFAULT_WORKFLOW_KEY;
}

export function isKnownWorkflowKey(value: unknown): value is WorkflowKey {
  return typeof value === "string" && (KNOWN_WORKFLOW_KEYS as readonly string[]).includes(value);
}
