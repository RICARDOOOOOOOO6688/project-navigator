-- =============================================================================
-- AI Studio / Project Navigator — FULL REBUILD for a fresh Supabase project
-- Target project ref: xiumymichxxksmtdmgis
--
-- Run ONCE in Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Written for an EMPTY project. Uses IF NOT EXISTS / ON CONFLICT so it is
-- safe to re-run.
--
-- Deliberately NOT created (superseded / unused):
--   providers, models, workflows, knowledge_bases, activity_events, user_quotas
--
-- Sections:
--   1. Project Navigator core tables (threads/messages/projects/tasks/...)
--   2. Roles (app_role enum + user_roles + has_role/is_admin + signup trigger)
--   3. AI control plane (ai_providers / ai_models / ai_workflows)
--   4. usage_events (AI run log)
--   5. Seeds (a Dify provider + the four workflows)
-- =============================================================================


-- =============================================================================
-- 1. Project Navigator core tables
-- =============================================================================

create table if not exists public.threads (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '新项目',
  stage text not null default 'idea',
  dify_conversation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.threads to authenticated;
grant all on public.threads to service_role;
alter table public.threads enable row level security;
drop policy if exists "Users manage their own threads" on public.threads;
create policy "Users manage their own threads" on public.threads
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.messages (
  id uuid not null default gen_random_uuid() primary key,
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.messages to authenticated;
grant all on public.messages to service_role;
alter table public.messages enable row level security;
drop policy if exists "Users manage their own messages" on public.messages;
create policy "Users manage their own messages" on public.messages
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists idx_threads_user_updated on public.threads (user_id, updated_at desc);
create index if not exists idx_messages_thread_created on public.messages (thread_id, created_at);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '新项目',
  description text not null default '',
  stage text not null default 'idea',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.projects to authenticated;
grant all on public.projects to service_role;
alter table public.projects enable row level security;
drop policy if exists "Users manage their own projects" on public.projects;
create policy "Users manage their own projects" on public.projects
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  status text not null default 'todo',
  stage text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.tasks to authenticated;
grant all on public.tasks to service_role;
alter table public.tasks enable row level security;
drop policy if exists "Users manage their own tasks" on public.tasks;
create policy "Users manage their own tasks" on public.tasks
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists tasks_project_id_idx on public.tasks (project_id);

create table if not exists public.decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  content text not null default '',
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.decisions to authenticated;
grant all on public.decisions to service_role;
alter table public.decisions enable row level security;
drop policy if exists "Users manage their own decisions" on public.decisions;
create policy "Users manage their own decisions" on public.decisions
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists decisions_project_id_idx on public.decisions (project_id);

create table if not exists public.project_facts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, key)
);
grant select, insert, update, delete on public.project_facts to authenticated;
grant all on public.project_facts to service_role;
alter table public.project_facts enable row level security;
drop policy if exists "Users manage their own project facts" on public.project_facts;
create policy "Users manage their own project facts" on public.project_facts
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists update_projects_updated_at on public.projects;
create trigger update_projects_updated_at before update on public.projects
  for each row execute function public.update_updated_at_column();
drop trigger if exists update_tasks_updated_at on public.tasks;
create trigger update_tasks_updated_at before update on public.tasks
  for each row execute function public.update_updated_at_column();
drop trigger if exists update_project_facts_updated_at on public.project_facts;
create trigger update_project_facts_updated_at before update on public.project_facts
  for each row execute function public.update_updated_at_column();

alter table public.threads
  add column if not exists project_id uuid references public.projects(id) on delete cascade;
create index if not exists threads_project_id_idx on public.threads (project_id);

-- Phone accounts: server-side mapping phone -> internal auth user.
create table if not exists public.phone_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone text not null unique,
  created_at timestamptz not null default now()
);
grant select on public.phone_accounts to authenticated;
grant all on public.phone_accounts to service_role;
alter table public.phone_accounts enable row level security;
drop policy if exists "Users can view their own phone account" on public.phone_accounts;
create policy "Users can view their own phone account" on public.phone_accounts
  for select to authenticated using (auth.uid() = user_id);


-- =============================================================================
-- 2. Roles
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('admin', 'user');
  end if;
end $$;

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'user',
  created_at timestamptz not null default now()
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
drop policy if exists "Users read their own role" on public.user_roles;
create policy "Users read their own role" on public.user_roles
  for select to authenticated using (auth.uid() = user_id);

create or replace function public.has_role(required public.app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = required
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_role('admin');
$$;

-- Every new auth user gets a 'user' role row automatically.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.user_roles (user_id, role)
  values (new.id, 'user')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =============================================================================
-- 3. AI control plane (reverse-engineered from the previous project)
-- =============================================================================

create table if not exists public.ai_providers (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null default '',
  base_url text,
  secret_ref text,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_models (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null default '',
  capabilities text[] not null default '{}',
  provider_key text,
  enabled boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_models_provider_key_idx on public.ai_models (provider_key);

create table if not exists public.ai_workflows (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null default '',
  secret_ref text,
  provider_key text,
  enabled boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_workflows_provider_key_idx on public.ai_workflows (provider_key);

do $$
declare t text;
begin
  foreach t in array array['ai_providers', 'ai_models', 'ai_workflows']
  loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', 'read_' || t, t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', 'read_' || t, t);
    execute format('drop trigger if exists %I on public.%I', 'update_' || t || '_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.update_updated_at_column()',
      'update_' || t || '_updated_at', t
    );
  end loop;
end $$;


-- =============================================================================
-- 4. usage_events (AI run log)
-- =============================================================================

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid,
  workflow_key text,
  model_key text,
  provider_key text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists usage_events_user_created_idx on public.usage_events (user_id, created_at desc);
grant select on public.usage_events to authenticated;
grant all on public.usage_events to service_role;
alter table public.usage_events enable row level security;
drop policy if exists "Users read own usage" on public.usage_events;
create policy "Users read own usage" on public.usage_events
  for select to authenticated using (auth.uid() = user_id);


-- =============================================================================
-- 5. Seeds — one Dify provider + the four workflows
--    (workflows fall back to the provider's secret_ref)
-- =============================================================================

insert into public.ai_providers (key, name, description, base_url, secret_ref, enabled)
values ('dify', 'Dify', 'Dify 应用（统一 chat 入口）', 'https://api.dify.ai', 'DIFY_API_KEY', false)
on conflict (key) do nothing;

insert into public.ai_workflows (key, name, description, provider_key, secret_ref, enabled, sort_order)
values
  ('research', 'Research', '', 'dify', null, false, 1),
  ('product', 'Product', '', 'dify', null, false, 2),
  ('architecture', 'Architecture', '', 'dify', null, false, 3),
  ('build', 'Build', '', 'dify', null, false, 4)
on conflict (key) do nothing;


-- =============================================================================
-- Done. Next: sign up a user, then grant yourself admin:
--
--   insert into public.user_roles (user_id, role)
--   select id, 'admin'::app_role from auth.users where email = 'r17324298266@163.com'
--   on conflict (user_id) do update set role = 'admin'::app_role;
-- =============================================================================
