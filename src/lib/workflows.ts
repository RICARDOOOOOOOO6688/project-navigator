import type { Project, Task, Decision, ProjectFact } from "@/lib/projects.functions";

/**
 * Integration boundary for the future
 * "AI 项目总管 → Research / Product / Architecture / Build Workflow" dispatch.
 *
 * Nothing here calls a real workflow yet: no workflow IDs are invented and no
 * fake responses are produced. When a Dify workflow is configured per
 * deployment, implement `WorkflowRunner` against it and register it below.
 */

export type WorkflowKey = "research" | "product" | "architecture" | "build";

export interface WorkflowContext {
  project: Pick<Project, "id" | "title" | "description" | "stage">;
  tasks: Task[];
  decisions: Decision[];
  facts: ProjectFact[];
  /** Free-form instruction coming from the AI 总管 conversation. */
  instruction: string;
}

export interface WorkflowResult {
  summary: string;
  /** Proposals the overview page can turn into real rows once approved. */
  proposedTasks?: Array<Pick<Task, "title"> & { stage?: string }>;
  proposedDecisions?: Array<Pick<Decision, "title" | "content">>;
  proposedFacts?: Array<Pick<ProjectFact, "key" | "value">>;
}

export interface WorkflowRunner {
  key: WorkflowKey;
  label: string;
  run(context: WorkflowContext): Promise<WorkflowResult>;
}

/** Registry stays empty on purpose until real workflows are configured. */
const REGISTRY: Partial<Record<WorkflowKey, WorkflowRunner>> = {};

export function getWorkflowRunner(key: WorkflowKey): WorkflowRunner | null {
  return REGISTRY[key] ?? null;
}

export function isWorkflowConnected(key: WorkflowKey): boolean {
  return getWorkflowRunner(key) !== null;
}
