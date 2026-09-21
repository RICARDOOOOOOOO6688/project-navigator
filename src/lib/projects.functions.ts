import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { StageId } from "@/lib/threads.functions";

export interface Project {
  id: string;
  user_id: string;
  title: string;
  description: string;
  stage: StageId;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  user_id: string;
  title: string;
  status: "todo" | "in_progress" | "done";
  stage: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Decision {
  id: string;
  project_id: string;
  user_id: string;
  title: string;
  content: string;
  created_at: string;
}

export interface ProjectFact {
  id: string;
  project_id: string;
  user_id: string;
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
}

// Explicit ownership check: returns the project only if it belongs to the
// caller, otherwise throws. RLS already scopes rows, but this gives a clear
// 404-style error instead of an empty result downstream.
async function requireOwnedProject(
  supabase: SupabaseClient<Database>,
  userId: string,
  projectId: string,
): Promise<Project> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();
  if (error || !data) throw new Error("项目不存在或无权访问");
  return data as Project;
}

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data as Project[];
  });

export const getProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    return requireOwnedProject(supabase, userId, data.projectId);
  });

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ title: z.string().optional() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: project, error } = await supabase
      .from("projects")
      .insert({ user_id: userId, title: data.title ?? "新项目" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return project as Project;
  });

export const updateProjectStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ projectId: z.string(), stage: z.string() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await requireOwnedProject(supabase, userId, data.projectId);
    const { error } = await supabase
      .from("projects")
      .update({ stage: data.stage })
      .eq("id", data.projectId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Update project name / description. Ownership is checked explicitly first.
export const updateProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        projectId: z.string(),
        title: z.string().min(1).max(120).optional(),
        description: z.string().max(2000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await requireOwnedProject(supabase, userId, data.projectId);
    const patch: { title?: string; description?: string } = {};
    if (data.title !== undefined) patch["title"] = data.title;
    if (data.description !== undefined) patch["description"] = data.description;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabase
      .from("projects")
      .update(patch)
      .eq("id", data.projectId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await requireOwnedProject(supabase, userId, data.projectId);
    const { data: tasks, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("project_id", data.projectId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return tasks as Task[];
  });

export const createTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        projectId: z.string(),
        title: z.string().min(1),
        stage: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await requireOwnedProject(supabase, userId, data.projectId);
    const { data: task, error } = await supabase
      .from("tasks")
      .insert({
        project_id: data.projectId,
        user_id: userId,
        title: data.title,
        stage: data.stage ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return task as Task;
  });

export const updateTaskStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        taskId: z.string(),
        status: z.enum(["todo", "in_progress", "done"]),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("tasks")
      .update({ status: data.status })
      .eq("id", data.taskId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listDecisions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await requireOwnedProject(supabase, userId, data.projectId);
    const { data: decisions, error } = await supabase
      .from("decisions")
      .select("*")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return decisions as Decision[];
  });

export const listProjectFacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await requireOwnedProject(supabase, userId, data.projectId);
    const { data: facts, error } = await supabase
      .from("project_facts")
      .select("*")
      .eq("project_id", data.projectId)
      .order("key", { ascending: true });
    if (error) throw new Error(error.message);
    return facts as ProjectFact[];
  });

// Interface boundary for the future AI 总管 → 专业 Workflow dispatch.
// The orchestrator will resolve a workflow key (e.g. "research", "product")
// to a concrete Dify workflow and run it with project context. No workflow
// IDs are hardcoded here on purpose — they are configured per deployment.
export const WORKFLOW_SLOTS = [
  { key: "research", label: "研究工作流", connected: false },
  { key: "product", label: "产品工作流", connected: false },
  { key: "architecture", label: "架构工作流", connected: false },
  { key: "build", label: "构建工作流", connected: false },
] as const;

export type WorkflowSlotKey = (typeof WORKFLOW_SLOTS)[number]["key"];

export const deleteTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ taskId: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("tasks")
      .delete()
      .eq("id", data.taskId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        projectId: z.string(),
        title: z.string().min(1),
        content: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await requireOwnedProject(supabase, userId, data.projectId);
    const { data: decision, error } = await supabase
      .from("decisions")
      .insert({
        project_id: data.projectId,
        user_id: userId,
        title: data.title,
        content: data.content ?? "",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return decision as Decision;
  });

export const deleteDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ decisionId: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("decisions")
      .delete()
      .eq("id", data.decisionId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const upsertProjectFact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        projectId: z.string(),
        key: z.string().min(1),
        value: z.string().default(""),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await requireOwnedProject(supabase, userId, data.projectId);
    const { data: existing } = await supabase
      .from("project_facts")
      .select("id")
      .eq("project_id", data.projectId)
      .eq("user_id", userId)
      .eq("key", data.key)
      .maybeSingle();
    if (existing) {
      const { error } = await supabase
        .from("project_facts")
        .update({ value: data.value })
        .eq("id", existing.id)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { error } = await supabase.from("project_facts").insert({
      project_id: data.projectId,
      user_id: userId,
      key: data.key,
      value: data.value,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteProjectFact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ factId: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("project_facts")
      .delete()
      .eq("id", data.factId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
