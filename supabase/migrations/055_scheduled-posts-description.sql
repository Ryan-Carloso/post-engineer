-- ============================================================================
-- 055 — description on scheduled_posts (issue #542 follow-up).
--
-- The agent-supplied video description is a per-post choice:
-- generate-and-schedule writes it on every slot and the engine's batch
-- pipeline (fill_schedule) reads it back when a tick-dispatched or
-- requeued slot is rebuilt, so publish uses the agent's copy instead of
-- the mechanical subject metadata. Nullable with no default: the
-- description is REQUIRED on every new request, and a pre-migration row
-- without one fails loudly at generation/publish time instead of falling
-- back to the title. Idempotent: rerunning adds the column only when
-- absent.
-- ============================================================================

alter table public.scheduled_posts
  add column if not exists description text;
