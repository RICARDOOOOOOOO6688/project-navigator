-- =============================================================================
-- Skill layer (v1) — pluggable AI instructions for the Direct Model path only.
-- Dify path is untouched and never loads skills.
--
-- Adds two tables:
--   ai_skills      — global, admin-managed skill catalog (instructions live here)
--   project_skills — per-project enablement + ordering
--
-- RLS: both tables are service-role only. Regular users never read them
-- directly (the Navigator server functions expose only safe fields, and never
-- the `instructions`). Admin writes go through the service role after the
-- existing admin guard.
--
-- Run once in Supabase SQL Editor. Safe to re-run.
-- =============================================================================

create table if not exists public.ai_skills (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null default '',
  instructions text not null default '',
  version text not null default '1.0.0',
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_skills (
  project_id uuid not null references public.projects(id) on delete cascade,
  skill_id uuid not null references public.ai_skills(id) on delete cascade,
  enabled boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  primary key (project_id, skill_id)
);
create index if not exists project_skills_project_idx on public.project_skills (project_id);

-- Service-role only: enable RLS, no authenticated policies.
alter table public.ai_skills enable row level security;
alter table public.project_skills enable row level security;
grant all on public.ai_skills to service_role;
grant all on public.project_skills to service_role;

drop trigger if exists update_ai_skills_updated_at on public.ai_skills;
create trigger update_ai_skills_updated_at before update on public.ai_skills
  for each row execute function public.update_updated_at_column();

-- --- sample skills (disabled by default) ------------------------------------
insert into public.ai_skills (key, name, description, instructions, version, enabled)
values
  (
    'competition_mentor',
    '大学生竞赛导师',
    '帮助进行竞赛选题、项目设计、创新点提炼、申报书与答辩',
    '你是资深大学生竞赛指导老师。围绕选题价值、创新点、可行性、评审标准给出结构化建议；主动指出薄弱环节并给出改进方向。回答简洁、可执行，善用分点。',
    '1.0.0',
    false
  ),
  (
    'literature_research',
    '文献研究',
    '系统性文献检索、综述与引用建议',
    '你擅长学术文献研究。帮助用户梳理研究现状、关键文献、争议点与空白；给出检索关键词与数据库建议；区分事实与推断，不编造文献。',
    '1.0.0',
    false
  ),
  (
    'business_analysis',
    '商业分析',
    '市场、竞品、商业模式与可行性的分析框架',
    '你是商业分析顾问。使用市场规模、用户画像、竞品对比、商业模式画布等框架分析问题；给出量化假设与验证方法；对不确定的数据明确标注。',
    '1.0.0',
    false
  )
on conflict (key) do nothing;

-- --- a Direct-Model provider + model example (disabled) ---------------------
-- For Direct Model the provider must be OpenAI-compatible, and
-- ai_models.key is sent to the API as the `model` value.
insert into public.ai_providers (key, name, description, base_url, secret_ref, enabled)
values ('deepseek', 'DeepSeek', 'OpenAI-compatible', 'https://api.deepseek.com/v1', 'DEEPSEEK_API_KEY', false)
on conflict (key) do nothing;

insert into public.ai_models (key, name, description, capabilities, provider_key, enabled, sort_order)
values ('deepseek-chat', 'DeepSeek Chat', 'deepseek-chat', '{chat}', 'deepseek', false, 1)
on conflict (key) do nothing;
