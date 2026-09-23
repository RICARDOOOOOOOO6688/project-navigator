-- =============================================================================
-- User / Project Knowledge — data layer + file storage (no RAG, no parsing,
-- no embedding, no SAG). Raw files live in Supabase Storage; metadata lives here.
--
--   knowledge_spaces     — a user's or project's knowledge space
--   knowledge_documents  — uploaded file metadata (bytes are in Storage)
--
-- RLS enforces: a user only touches their own spaces/documents, and project
-- scope additionally requires the referenced project to belong to the user.
--
-- Run once in Supabase SQL Editor. Safe to re-run.
-- =============================================================================

-- --- knowledge_spaces --------------------------------------------------------
create table if not exists public.knowledge_spaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  name text not null,
  description text,
  scope text not null default 'user' check (scope in ('user', 'project')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists knowledge_spaces_user_idx on public.knowledge_spaces (user_id);
create index if not exists knowledge_spaces_project_idx on public.knowledge_spaces (project_id);

-- --- knowledge_documents -----------------------------------------------------
create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  knowledge_space_id uuid not null references public.knowledge_spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  filename text not null,
  mime_type text not null default '',
  size_bytes bigint not null default 0,
  storage_path text not null,
  status text not null default 'ready' check (status in ('pending', 'ready', 'error')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists knowledge_documents_space_idx on public.knowledge_documents (knowledge_space_id);
create index if not exists knowledge_documents_user_idx on public.knowledge_documents (user_id);

-- --- updated_at triggers -----------------------------------------------------
drop trigger if exists update_knowledge_spaces_updated_at on public.knowledge_spaces;
create trigger update_knowledge_spaces_updated_at before update on public.knowledge_spaces
  for each row execute function public.update_updated_at_column();
drop trigger if exists update_knowledge_documents_updated_at on public.knowledge_documents;
create trigger update_knowledge_documents_updated_at before update on public.knowledge_documents
  for each row execute function public.update_updated_at_column();

-- --- grants + RLS ------------------------------------------------------------
grant select, insert, update, delete on public.knowledge_spaces to authenticated;
grant select, insert, update, delete on public.knowledge_documents to authenticated;
grant all on public.knowledge_spaces to service_role;
grant all on public.knowledge_documents to service_role;

alter table public.knowledge_spaces enable row level security;
alter table public.knowledge_documents enable row level security;

-- spaces: own row, and project scope must reference an own project
drop policy if exists "Users manage their own knowledge spaces" on public.knowledge_spaces;
create policy "Users manage their own knowledge spaces" on public.knowledge_spaces
  for all to authenticated
  using (
    auth.uid() = user_id
    and (
      scope = 'user'
      or (
        scope = 'project'
        and project_id is not null
        and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
      )
    )
  )
  with check (
    auth.uid() = user_id
    and (
      scope = 'user'
      or (
        scope = 'project'
        and project_id is not null
        and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
      )
    )
  );

-- documents: own row, space must be owned, project (if any) must be owned
drop policy if exists "Users manage their own knowledge documents" on public.knowledge_documents;
create policy "Users manage their own knowledge documents" on public.knowledge_documents
  for all to authenticated
  using (
    auth.uid() = user_id
    and exists (select 1 from public.knowledge_spaces s where s.id = knowledge_space_id and s.user_id = auth.uid())
    and (
      project_id is null
      or exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
    )
  )
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.knowledge_spaces s where s.id = knowledge_space_id and s.user_id = auth.uid())
    and (
      project_id is null
      or exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
    )
  );

-- --- Storage bucket + policies ----------------------------------------------
insert into storage.buckets (id, name, public)
values ('knowledge', 'knowledge', false)
on conflict (id) do nothing;

-- Objects are stored under users/{user_id}/knowledge/... — every policy pins the
-- 2nd path segment to the caller's uid so no user can touch another's files.
drop policy if exists "Users read own knowledge files" on storage.objects;
create policy "Users read own knowledge files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'knowledge'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "Users upload own knowledge files" on storage.objects;
create policy "Users upload own knowledge files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'knowledge'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "Users update own knowledge files" on storage.objects;
create policy "Users update own knowledge files" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'knowledge'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'knowledge'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "Users delete own knowledge files" on storage.objects;
create policy "Users delete own knowledge files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'knowledge'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
