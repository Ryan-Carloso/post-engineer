-- ============================================================================
-- Migration 009 — Correlate prepaid batch charges with their engine task
-- ----------------------------------------------------------------------------
-- HOW TO APPLY: Supabase Dashboard > SQL Editor > New query > paste & run,
-- after 008_video-generations-engine-task-id-idx.sql. Safe to re-run
-- (idempotent): the backfill only fills NULLs and the index is IF NOT EXISTS.
--
-- WHY: a scheduled post is charged ONCE, up front, under the batch
-- generation id `batch:<schedule_id>` (token_transactions.engine_task_id is
-- NULL — the engine has not minted a task id yet at charge time). Each slot
-- then dispatches its own engine task and stores it on the slot's
-- video_generations row, whose generation_id is `batch:<schedule_id>:slot:<slot_id>`.
--
-- Everything that resolves a generation FROM a task id by querying
-- token_transactions.engine_task_id therefore found nothing for every
-- scheduled post. The failure paths that need that lookup gave up early, so
-- a slot whose engine task was lost (engine restart) kept status `running`
-- in the history table forever, and the UI polled a task the engine no
-- longer had.
--
-- WHAT THIS DOES: for a batch that produced exactly ONE slot, the charge
-- and the task are unambiguously the same generation, so the missing
-- correlation is derivable and is backfilled onto the charge row. Multi-slot
-- batches are deliberately NOT touched — one prepaid charge covers several
-- videos, so attributing it to any single task id would be wrong (and would
-- make a per-generation refund refund a shared charge).
--
-- This narrows the gap for single-video schedules; the batch fallback in the
-- web's gone-task reconciler covers the multi-slot case without a charge
-- write, so no post is left permanently `running` either way.
-- ============================================================================

-- 1. Backfill: single-slot batch charges inherit their slot's engine task.
--    Scoped to engine_task_id IS NULL so a re-run never rewrites a charge
--    that already carries a correlation.
update public.token_transactions t
set engine_task_id = v.engine_task_id
from public.video_generations v
where t.type = 'video_generation'
  and t.engine_task_id is null
  and t.generation_id like 'batch:%'
  and t.generation_id not like 'batch:%:slot:%'
  and v.generation_id like t.generation_id || ':slot:%'
  and v.engine_task_id is not null
  and v.user_id = t.user_id
  -- Exactly one slot generation for this batch: the charge maps to exactly
  -- one task, so the correlation is unambiguous.
  and 1 = (
    select count(*)
    from public.video_generations v2
    where v2.user_id = t.user_id
      and v2.generation_id like t.generation_id || ':slot:%'
  );

-- 2. Index for the batch-charge lookup (generation_id + user + type). The
--    per-task reconciliation resolves a batch charge by this triple on every
--    gone-task settle, and token_transactions is the largest table here.
create index if not exists token_transactions_batch_generation_idx
  on public.token_transactions (user_id, generation_id)
  where type = 'video_generation';

-- 3. Index for the slot lookup by task id used by the gone-task reconciler
--    to derive a batch id from a dropped task. Without it this is a scan of
--    every scheduled_posts row on each settle.
create index if not exists scheduled_posts_task_id_idx
  on public.scheduled_posts (user_id, task_id)
  where task_id is not null;