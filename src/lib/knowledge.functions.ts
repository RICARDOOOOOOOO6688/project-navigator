// User / Project Knowledge server functions (data layer only).
//
// No parsing / chunking / embedding / RAG / SAG, and NOT wired into /api/chat.
// Raw bytes live in Supabase Storage (bucket "knowledge"); these functions
// manage the metadata and enforce ownership server-side.

import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { KNOWLEDGE_BUCKET, isKnowledgePathOwnedBy } from "@/lib/knowledge/storage.server";

async function adminClient(): Promise<SupabaseClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient;
}

export interface KnowledgeSpace {
  id: string;
  user_id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  scope: "user" | "project";
  created_at: string;
  updated_at: string;
}

export interface KnowledgeDocument {
  id: string;
  knowledge_space_id: string;
  user_id: string;
  project_id: string | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  status: string;
  metadata: Record<string, string | number | boolean | null>;
  created_at: string;
  updated_at: string;
}

async function requireOwnedSpace(
  db: SupabaseClient,
  userId: string,
  spaceId: string,
): Promise<KnowledgeSpace> {
  const { data, error } = await db
    .from("knowledge_spaces")
    .select("*")
    .eq("id", spaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("知识空间不存在或无权访问");
  return data as unknown as KnowledgeSpace;
}

// --- spaces ------------------------------------------------------------------

export const listKnowledgeSpaces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<KnowledgeSpace[]> => {
    const db = await adminClient();
    const { data, error } = await db
      .from("knowledge_spaces")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as KnowledgeSpace[];
  });

export const createKnowledgeSpace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().min(1).max(120),
        description: z.string().max(2000).optional(),
        scope: z.enum(["user", "project"]),
        projectId: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<KnowledgeSpace> => {
    const db = await adminClient();
    let projectId: string | null = null;
    if (data.scope === "project") {
      if (!data.projectId) throw new Error("project scope 需要 projectId");
      const { data: project, error } = await db
        .from("projects")
        .select("id")
        .eq("id", data.projectId)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!project) throw new Error("项目不存在或无权访问");
      projectId = data.projectId;
    }
    const { data: row, error } = await db
      .from("knowledge_spaces")
      .insert({
        user_id: context.userId,
        project_id: projectId,
        name: data.name.trim(),
        description: data.description ?? null,
        scope: data.scope,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as unknown as KnowledgeSpace;
  });

export const updateKnowledgeSpace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        spaceId: z.string(),
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(2000).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const db = await adminClient();
    await requireOwnedSpace(db, context.userId, data.spaceId);
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch["name"] = data.name.trim();
    if (data.description !== undefined) patch["description"] = data.description;
    if (Object.keys(patch).length > 0) {
      const { error } = await db.from("knowledge_spaces").update(patch).eq("id", data.spaceId);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteKnowledgeSpace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ spaceId: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await adminClient();
    await requireOwnedSpace(db, context.userId, data.spaceId);

    // Remove the space's stored files first (best effort), then the row.
    const { data: docs } = await db
      .from("knowledge_documents")
      .select("storage_path")
      .eq("knowledge_space_id", data.spaceId)
      .eq("user_id", context.userId);
    const paths = ((docs ?? []) as unknown as { storage_path: string }[])
      .map((d) => d.storage_path)
      .filter((p) => isKnowledgePathOwnedBy(p, context.userId));
    if (paths.length > 0) {
      try {
        await db.storage.from(KNOWLEDGE_BUCKET).remove(paths);
      } catch (err) {
        console.error("[knowledge] remove files failed", (err as Error).message);
      }
    }

    const { error } = await db.from("knowledge_spaces").delete().eq("id", data.spaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// --- documents ---------------------------------------------------------------

export const listKnowledgeDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ spaceId: z.string() }).parse(input))
  .handler(async ({ context, data }): Promise<KnowledgeDocument[]> => {
    const db = await adminClient();
    await requireOwnedSpace(db, context.userId, data.spaceId);
    const { data: docs, error } = await db
      .from("knowledge_documents")
      .select("*")
      .eq("knowledge_space_id", data.spaceId)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (docs ?? []) as unknown as KnowledgeDocument[];
  });

/**
 * Record document metadata after the client uploaded bytes to Storage.
 * The server pins the storage path to the caller's own prefix and verifies the
 * space ownership, so a client cannot register another user's file.
 */
export const createKnowledgeDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        spaceId: z.string(),
        filename: z.string().min(1).max(255),
        mimeType: z.string().max(255).optional(),
        sizeBytes: z.number().int().nonnegative().optional(),
        storagePath: z.string().min(1).max(1024),
        metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<KnowledgeDocument> => {
    const db = await adminClient();
    const space = await requireOwnedSpace(db, context.userId, data.spaceId);
    if (!isKnowledgePathOwnedBy(data.storagePath, context.userId)) {
      throw new Error("storagePath 不属于当前用户");
    }
    if (!data.storagePath.includes(`/knowledge/${data.spaceId}/`)) {
      throw new Error("storagePath 与知识空间不匹配");
    }

    const { data: row, error } = await db
      .from("knowledge_documents")
      .insert({
        knowledge_space_id: data.spaceId,
        user_id: context.userId,
        project_id: space.project_id,
        filename: data.filename,
        mime_type: data.mimeType ?? "",
        size_bytes: data.sizeBytes ?? 0,
        storage_path: data.storagePath,
        status: "ready",
        metadata: data.metadata ?? {},
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as unknown as KnowledgeDocument;
  });

export const deleteKnowledgeDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ documentId: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const db = await adminClient();
    const { data: doc, error: readError } = await db
      .from("knowledge_documents")
      .select("id, user_id, storage_path")
      .eq("id", data.documentId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!doc) throw new Error("文档不存在或无权访问");
    const typed = doc as unknown as { storage_path: string };

    if (isKnowledgePathOwnedBy(typed.storage_path, context.userId)) {
      try {
        await db.storage.from(KNOWLEDGE_BUCKET).remove([typed.storage_path]);
      } catch (err) {
        console.error("[knowledge] remove file failed", (err as Error).message);
      }
    }

    const { error } = await db.from("knowledge_documents").delete().eq("id", data.documentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
