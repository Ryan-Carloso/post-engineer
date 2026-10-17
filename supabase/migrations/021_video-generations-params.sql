-- ============================================================================
-- Migration 021 — Persist the full engine job payload on video_generations
-- ----------------------------------------------------------------------------
-- WHY: "generate now" and scheduled generations share one pipeline, but only
-- scheduled slots persist their full params (scheduled_posts). A direct
-- generation's params live only in the engine process memory, so the boot
-- triage cannot rebuild it after a restart. Storing the payload here lets
-- the engine re-dispatch an orphaned direct task from the database row
-- (issue #205).
--
-- publish_mode unifies the two entry points at the storage boundary:
-- 'asap' posts as soon as the video is ready, 'scheduled' posts at
-- scheduled_at. The CHECK pins exactly the modes the app writes (mirrors
-- migrations/015_schedules-publish-mode.sql).
--
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere).
-- ============================================================================

alter table public.video_generations
  add column if not exists params jsonb,
  add column if not exists publish_mode text not null default 'asap',
  add column if not exists scheduled_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'video_generations_publish_mode_check'
  ) then
    alter table public.video_generations
      add constraint video_generations_publish_mode_check
      check (publish_mode in ('asap', 'scheduled'));
  end if;
end $$;

-- The boot triage looks up the orphan's row by engine_task_id and needs the
-- payload in the same read; the partial index keeps that lookup cheap while
-- leaving historical snapshot-only rows out of the index.
create index if not exists video_generations_redispatch_idx
  on public.video_generations (engine_task_id)
  where params is not null;
