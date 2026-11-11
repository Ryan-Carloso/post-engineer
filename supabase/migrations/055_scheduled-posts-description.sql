-- ============================================================================
-- 055 — description on scheduled_posts (issue #542 follow-up).
--
-- The agent-supplied video description is a per-post choice:
-- generate-and-schedule writes it on every slot and the engine's batch
-- pipeline (fill_schedule) reads it back when a tick-dispatched or
-- requeued slot is rebuilt, so publish uses the agent's copy instead of
-- the mechanical subject metadata. Nullable with no default: the
-- description is REQUIRED on every new request.
--
-- Backfill: a pre-migration row has no description, but it is already
-- prepaid, so it must keep generating instead of failing loudly for a
-- field that did not exist when it was created. The slot title is the
-- old publish copy's source (the mechanical caption was derived from
-- the same subject), so it becomes the description. A row with no title
-- at all keeps NULL and still fails loudly in validate_publish_plan.
-- Idempotent: rerunning adds the column only when absent and only fills
-- rows that are still NULL.
-- ============================================================================

alter table public.scheduled_posts
  add column if not exists description text;

update public.scheduled_posts
  set description = title
  where description is null;
