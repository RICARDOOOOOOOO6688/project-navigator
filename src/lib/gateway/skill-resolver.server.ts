// Skill Resolver (server-only) — Direct Model path only.
//
// project_id → project_skills → ai_skills (enabled) → ordered instructions.
// Never imported by the Dify executor.

import { gatewayDb } from "./db.server";

export interface ResolvedSkill {
  id: string;
  key: string;
  name: string;
  version: string;
  instructions: string;
  sort_order: number;
}

interface ProjectSkillLink {
  skill_id: string;
  enabled: boolean;
  sort_order: number;
}

interface SkillRow {
  id: string;
  key: string;
  name: string;
  version: string;
  instructions: string;
  enabled: boolean;
}

/** Enabled skills for a project, in project_skills.sort_order. */
export async function resolveProjectSkills(projectId: string | null): Promise<ResolvedSkill[]> {
  if (!projectId) return [];
  const db = gatewayDb();

  const linksRes = await db
    .from("project_skills")
    .select("skill_id, enabled, sort_order")
    .eq("project_id", projectId)
    .eq("enabled", true)
    .order("sort_order", { ascending: true });
  if (linksRes.error || !linksRes.data) return [];
  const links = linksRes.data as unknown as ProjectSkillLink[];
  if (links.length === 0) return [];

  const ids = links.map((l) => l.skill_id);
  const skillsRes = await db
    .from("ai_skills")
    .select("id, key, name, version, instructions, enabled")
    .in("id", ids)
    .eq("enabled", true);
  if (skillsRes.error || !skillsRes.data) return [];
  const byId = new Map((skillsRes.data as unknown as SkillRow[]).map((s) => [s.id, s]));

  const out: ResolvedSkill[] = [];
  for (const link of links) {
    const s = byId.get(link.skill_id);
    if (!s) continue; // disabled skill → not loaded
    out.push({
      id: s.id,
      key: s.key,
      name: s.name,
      version: s.version,
      instructions: s.instructions,
      sort_order: link.sort_order,
    });
  }
  return out;
}
