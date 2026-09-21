-- =============================================================================
-- AI Studio control plane
--
-- Shared by Project Navigator (reads enabled config to route requests) and the
-- Admin app (service role; reads/writes everything).
--
-- Real API keys never live in these tables. Only a reference (`secret_ref`) and
-- where to resolve it (`secret_source`) are stored. The resolver reads the value
-- from a Cloudflare Worker binding or Supabase Vault at call time.
-- =============================================================================

-- --- roles -------------------------------------------------------------------
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user'
    check (role in ('admin', 'operator', 'editor', 'user')),
  created_at timestamptz not null default now()
);

alter table public.user_roles enable row level security;
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

drop policy if exists "Users read their own role" on public.user_roles;
create policy "Users read their own role" on public.user_roles
  for select to authenticated using (auth.uid() = user_id);

create or replace function public.has_role(required text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = required
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('admin');
$$;

-- --- providers ---------------------------------------------------------------
create table if not exists public.providers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  kind text not null,
  base_url text,
  secret_ref text,
  secret_source text not null default 'cloudflare_env'
    check (secret_source in ('cloudflare_env', 'supabase_vault')),
  enabled boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- --- models ------------------------------------------------------------------
create table if not exists public.models (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  model_key text not null unique,
  display_name text not null,
  upstream_id text not null,
  description text not null default '',
  capabilities text[] not null default '{}',
  slots text[] not null default '{}',
  enabled boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists models_provider_id_idx on public.models (provider_id);

-- --- workflows ---------------------------------------------------------------
create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  dify_app_id text,
  app_type text not null default 'workflow'
    check (app_type in ('workflow', 'chatflow')),
  secret_ref text,
  secret_source text not null default 'cloudflare_env'
    check (secret_source in ('cloudflare_env', 'supabase_vault')),
  enabled boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- --- knowledge bases ---------------------------------------------------------
create table if not exists public.knowledge_bases (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  scope text not null default 'global' check (scope in ('global', 'project')),
  source text not null default 'dify_dataset'
    check (source in ('dify_dataset', 'pgvector')),
  external_id text,
  description text not null default '',
  enabled boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- --- grants + RLS ------------------------------------------------------------
-- Config is not secret (secret_ref is only a name). Authenticated users may read
-- it; only the service role (Admin) writes.
do $$
declare t text;
begin
  foreach t in array array['providers', 'models', 'workflows', 'knowledge_bases']
  loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', 'read_' || t, t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      'read_' || t, t
    );
  end loop;
end $$;

-- --- updated_at triggers -----------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['providers', 'models', 'workflows', 'knowledge_bases']
  loop
    execute format(
      'drop trigger if exists %I on public.%I',
      'update_' || t || '_updated_at', t
    );
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.update_updated_at_column()',
      'update_' || t || '_updated_at', t
    );
  end loop;
end $$;

-- --- seed: providers (disabled, no secret_ref yet) ---------------------------
insert into public.providers (slug, name, kind, base_url, sort_order)
values
  ('openai', 'OpenAI', 'openai', 'https://api.openai.com/v1', 1),
  ('anthropic', 'Anthropic', 'anthropic', 'https://api.anthropic.com', 2),
  ('google', 'Google', 'google', 'https://generativelanguage.googleapis.com', 3),
  ('deepseek', 'DeepSeek', 'deepseek', 'https://api.deepseek.com/v1', 4)
on conflict (slug) do nothing;

-- --- seed: workflows (disabled) ---------------------------------------------
insert into public.workflows (key, label, sort_order)
values
  ('research', 'Research', 1),
  ('product', 'Product', 2),
  ('architecture', 'Architecture', 3),
  ('build', 'Build', 4)
on conflict (key) do nothing;

-- --- usage / quotas / activity (read-only in Admin phase 1) ------------------
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  capability text not null,
  model_key text,
  workflow_key text,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  cost numeric(12, 6) not null default 0,
  latency_ms int,
  status text not null default 'ok' check (status in ('ok', 'error')),
  created_at timestamptz not null default now()
);
create index if not exists usage_events_user_created_idx
  on public.usage_events (user_id, created_at desc);

create table if not exists public.user_quotas (
  user_id uuid primary key references auth.users(id) on delete cascade,
  period text not null default 'monthly',
  token_limit bigint,
  token_used bigint not null default 0,
  cost_limit numeric(12, 6),
  cost_used numeric(12, 6) not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  title text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists activity_events_created_idx
  on public.activity_events (created_at desc);

grant select on public.usage_events to authenticated;
grant select on public.user_quotas to authenticated;
grant select on public.activity_events to authenticated;
grant all on public.usage_events, public.user_quotas, public.activity_events
  to service_role;

alter table public.usage_events enable row level security;
alter table public.user_quotas enable row level security;
alter table public.activity_events enable row level security;

drop policy if exists "Users read own usage" on public.usage_events;
create policy "Users read own usage" on public.usage_events
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users read own quota" on public.user_quotas;
create policy "Users read own quota" on public.user_quotas
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Admins read activity" on public.activity_events;
create policy "Admins read activity" on public.activity_events
  for select to authenticated using (public.is_admin());

drop trigger if exists update_user_quotas_updated_at on public.user_quotas;
create trigger update_user_quotas_updated_at before update on public.user_quotas
  for each row execute function public.update_updated_at_column();
