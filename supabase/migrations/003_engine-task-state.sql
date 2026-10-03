-- ============================================================================
-- Migration 003 — Engine task state (persistent, survives restarts/redeploys)
-- ----------------------------------------------------------------------------
-- HOW TO APPLY: Supabase Dashboard > SQL Editor > New query > paste & run,
-- after 001_schema.sql. Only needed when running the engine with
-- MPT_STATE_BACKEND=supabase. Safe to re-run (all statements are idempotent).
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

-- 4. Retention: rows are never deleted by the engine (delete_task only fires
--    on the queue-full rejection path), so this table grows by one row per
--    video task. Prune terminal rows periodically (e.g. delete where state
--    in (-1, 1) and updated_at < now() - interval '90 days'), or add a
--    scheduled cleanup job later.
