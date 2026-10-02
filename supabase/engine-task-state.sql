-- ============================================================================
-- Engine task state (persistent, survives engine restarts/redeploys)
-- ----------------------------------------------------------------------------
-- HOW TO APPLY: Supabase Dashboard > SQL Editor > New query > paste & run.
-- The schema is not versioned in this repo; apply once per Supabase project.
-- Safe to re-run (all statements are idempotent).
--
-- WHY: the engine kept video-generation task state in process memory, so
-- every restart/redeploy wiped it and status polls answered 404 "task not
-- found" forever. With MPT_STATE_BACKEND=supabase the engine persists task
-- state here instead; the backend fails fast at boot if this table is
-- missing, with a message pointing at this file.
-- ============================================================================

-- 1. Task state table: one row per engine task. The flexible task payload
--    (stage, videos, error, ...) lives in the data JSONB column; state and
--    progress are top-level for filtering/ordering.
create table if not exists public.engine_task_state (
  task_id text primary key,
  user_id text,
  state integer not null default 0,
  progress integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2. Row Level Security: the engine connects with the service_role key,
--    which bypasses RLS. No policies are created on purpose: no other
--    database role can read or write task state.
alter table public.engine_task_state enable row level security;

-- 3. Fast "my tasks" listing for the engine task browser.
create index if not exists engine_task_state_user_id_updated_at_idx
  on public.engine_task_state (user_id, updated_at desc);
