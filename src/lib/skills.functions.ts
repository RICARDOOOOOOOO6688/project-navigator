// Client-callable server functions for the Direct Model + Skill UI.
// Skills/instructions live in ai_skills (service-role only); the client only
// ever receives id/key/name/description/version and whether the project enabled
// it. `instructions` is never exposed.

import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Access control-plane / skill tables that are not in the generated Database
// type, via the untyped service-role client (server-only, ownership checked).
async function adminClient(): Promise<SupabaseClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient;
}

export interface DirectModelOption {
  key: string;
  name: string;
  description: string;
  provider_key: string | null;
  provider_name: string | null;
}

export interface SkillOption {
  id: string;
  key: string;
  name: string;
  description: string;
  version: string;
  enabled_for_project: boolean;
  sort_order: number;
}

async function assertProjectOwned(userId: string, projectId: string): Promise<void> {
  const db = await adminClient();
  const { data } = await db
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new Error("项目不存在或无权访问");
}

/** Enabled models whose provider is enabled and has a base_url. */
export const listDirectModels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<DirectModelOption[]> => {
    const db = await adminClient();
    const [mRes, pRes] = await Promise.all([
      db
        .from("ai_models")
        .select("key, name, description, provider_key, enabled")
        .eq("enabled", true)
        .order("sort_order", { ascending: true }),
      db.from("ai_providers").select("key, name, enabled, base_url"),
    ]);
    const providers = new Map<string, string>();
    for (const p of (pRes.data ?? []) as unknown as {
      key: string;
      name: string;
      enabled: boolean;
      base_url: string | null;
    }[]) {
      if (p.enabled && p.base_url?.trim()) providers.set(p.key, p.name);
    }
    return (
      (mRes.data ?? []) as unknown as {
        key: string;
        name: string;
        description: string;
        provider_key: string | null;
      }[]
    )
      .filter((m) => m.provider_key && providers.has(m.provider_key))
      .map((m) => ({
        key: m.key,
        name: m.name,
        description: m.description,
        provider_key: m.provider_key,
        provider_name: m.provider_key ? (providers.get(m.provider_key) ?? null) : null,
      }));
  });

/** Skills available to a project, with the project's enablement flag. */
export const listProjectSkills = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string() }).parse(input))
  .handler(async ({ context, data }): Promise<SkillOption[]> => {
    await assertProjectOwned(context.userId, data.projectId);
    const db = await adminClient();
    const [sRes, lRes] = await Promise.all([
      db
        .from("ai_skills")
        .select("id, key, name, description, version, enabled")
        .eq("enabled", true)
        .order("name", { ascending: true }),
      db
        .from("project_skills")
        .select("skill_id, enabled, sort_order")
        .eq("project_id", data.projectId),
    ]);
    const links = new Map<string, { enabled: boolean; sort_order: number }>();
    for (const l of (lRes.data ?? []) as unknown as {
      skill_id: string;
      enabled: boolean;
      sort_order: number;
    }[]) {
      links.set(l.skill_id, l);
    }
    return (
      (sRes.data ?? []) as unknown as {
        id: string;
        key: string;
        name: string;
        description: string;
        version: string;
      }[]
    ).map((s) => {
      const link = links.get(s.id);
      return {
        id: s.id,
        key: s.key,
        name: s.name,
        description: s.description,
        version: s.version,
        enabled_for_project: Boolean(link?.enabled),
        sort_order: link?.sort_order ?? 0,
      };
    });
  });

export const toggleProjectSkill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        projectId: z.string(),
        skillId: z.string(),
        enabled: z.boolean(),
        sortOrder: z.number().int().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertProjectOwned(context.userId, data.projectId);
    const db = await adminClient();
    const { error } = await db.from("project_skills").upsert(
      {
        project_id: data.projectId,
        skill_id: data.skillId,
        enabled: data.enabled,
        sort_order: data.sortOrder ?? 0,
      },
      { onConflict: "project_id,skill_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
