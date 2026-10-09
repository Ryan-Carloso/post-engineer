-- ============================================================================
-- Migration 016 — Publish attempt counter on scheduled_posts
-- ----------------------------------------------------------------------------
-- Applied automatically: the deploy workflow runs `supabase db push` (pending
-- only) on every merge to main. Never apply by hand in the dashboard.
-- Safe to re-run (idempotent): every statement is guarded on the object it
-- needs.
--
-- WHY: the fill_schedule publish tick retries a failed publish on every
-- later tick with no bound — a slot whose publish can never succeed (e.g. a
-- broken R2 configuration) retries forever until a human cancels it. The
-- engine now counts publish attempts per slot and auto-cancels (failed) with
-- a token refund after MAX_PUBLISH_ATTEMPTS (3) failures.
--
-- NULL semantics: NOT NULL DEFAULT 0 — every row created before this
-- migration has never had a counted publish attempt, so 0 backfills the
-- truth, not a guess.
-- ============================================================================

alter table public.scheduled_posts
  add column if not exists publish_attempts integer not null default 0;
