-- ============================================================================
-- Migration 008 — Index video_generations.engine_task_id for task lookups
-- ----------------------------------------------------------------------------
-- HOW TO APPLY: Supabase Dashboard > SQL Editor > New query > paste & run,
-- after 007_personas-drop-face-mix.sql. Safe to re-run (idempotent).
--
-- WHY: the engine mints its own task_id per video job; the web stores it on
-- the video_generations row (engine_task_id) when the engine accepts the job.
-- Debugging a generation from the engine side ("which generation lost this
-- task?") filters on engine_task_id — without an index that is a full scan.
-- No FK: engine_task_state is ephemeral, so a foreign key would break on
-- every task-state cleanup. The plain join is all we need.
-- ============================================================================

create index if not exists video_generations_engine_task_id_idx
  on public.video_generations (engine_task_id);
