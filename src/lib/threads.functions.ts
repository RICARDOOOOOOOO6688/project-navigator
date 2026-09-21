import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const STAGES = [
  { id: "idea", label: "想法" },
  { id: "research", label: "市场调研" },
  { id: "project", label: "我的项目" },
  { id: "architecture", label: "架构设计" },
  { id: "build", label: "项目构建" },
] as const;

export type StageId = (typeof STAGES)[number]["id"];

export const listThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("threads")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data as Thread[];
  });

export const createThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ title: z.string().optional(), projectId: z.string().optional() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    // When a projectId is given, verify ownership before linking.
    if (data.projectId) {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("id")
        .eq("id", data.projectId)
        .eq("user_id", userId)
        .single();
      if (projectError || !project) throw new Error("项目不存在或无权访问");
    }
    const { data: thread, error } = await supabase
      .from("threads")
      .insert({
        user_id: userId,
        title: data.title ?? "新项目",
        ...(data.projectId ? { project_id: data.projectId } : {}),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return thread as Thread;
  });

// Get (or lazily create) the chat thread attached to a project.
export const getProjectThread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, title")
      .eq("id", data.projectId)
      .eq("user_id", userId)
      .single();
    if (projectError || !project) throw new Error("项目不存在或无权访问");

    const { data: existing } = await supabase
      .from("threads")
      .select("*")
      .eq("project_id", data.projectId)
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existing) return existing as Thread;

    const { data: thread, error } = await supabase
      .from("threads")
      .insert({
        user_id: userId,
        title: project.title,
        project_id: data.projectId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return thread as Thread;
  });

export const deleteThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { error } = await supabase.from("threads").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getThreadMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ threadId: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: messages, error } = await supabase
      .from("messages")
      .select("*")
      .eq("thread_id", data.threadId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return messages as ChatMessage[];
  });

export const updateThreadStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ threadId: z.string(), stage: z.string() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("threads")
      .update({ stage: data.stage, updated_at: new Date().toISOString() })
      .eq("id", data.threadId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const renameThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ threadId: z.string(), title: z.string() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("threads")
      .update({ title: data.title })
      .eq("id", data.threadId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export interface Thread {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  stage: StageId;
  dify_conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}
