-- ============================================================================
-- Migration 008 — Index video_generations.engine_task_id
-- ----------------------------------------------------------------------------
-- HOW TO APPLY: applied automatically by the deploy pipeline
-- (`supabase db push`, pending migrations only) after merge to main.
-- Safe to re-run (idempotent).
--
-- WHY: every web video generation is two IDs for the same unit of work —
-- generation_id (the video_generations row id, what the UI shows) and
-- engine_task_id (the engine's task id, what the engine's PostHog telemetry
-- and its status polls carry). The engine stamps generation_id on every
-- PostHog lifecycle event, so debugging goes PostHog-first; this index is
-- the other direction — given a task_id (e.g. from an engine log line or
-- the web's status poll), find the video_generations row without a full
-- table scan.
--
-- NO foreign key to engine_task_state: that table is ephemeral (task state
-- only; rows are deleted when tasks complete), so a FK would break the
-- engine's task cleanup. This index is on the plain text column only.
-- ============================================================================

create index if not exists video_generations_engine_task_id_idx
  on public.video_generations (engine_task_id);
