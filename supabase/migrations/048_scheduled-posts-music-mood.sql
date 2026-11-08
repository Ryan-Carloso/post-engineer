-- ============================================================================
-- 045 — music_mood on scheduled_posts (issue #489).
--
-- The requested BGM mood is a per-post choice: generate-and-schedule writes
-- it on every slot and the engine's batch pipeline (fill_schedule
-- .slot_music_mood) reads it back when a tick-dispatched or requeued slot
-- is rebuilt, so the video renders with the requested mood instead of the
-- engine's default. Nullable with no default: rows created before this
-- migration render the default, as every earlier video did. Idempotent:
-- rerunning adds the column only when absent.
-- ============================================================================

alter table public.scheduled_posts
  add column if not exists music_mood text;
