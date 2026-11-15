-- ============================================================================
-- 064 — Claim ownership on scheduled_posts (issue #384).
--
-- A resumed upload slot trusts a `consumed` video_uploads row only when
-- the row is the claim its own first attempt won. The engine records the
-- claim on the slot (media_claimed_at = the row's consumed_at) at claim
-- time; on resume it re-uses the row only when consumed_at matches. A
-- `consumed` row claimed by another consumer (a second slot with the same
-- upload id, or an ASAP publish) fails the slot permanently instead of
-- re-publishing media that is already live or re-downloading an object
-- that is already gone.
-- Idempotent (add-if-missing).
-- ============================================================================

alter table public.scheduled_posts
  add column if not exists media_claimed_at timestamptz;
