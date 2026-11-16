-- ============================================================================
-- 065 — One live slot per signed upload (issue #384 follow-up).
--
-- A signed video upload is single-use: the engine claims it ready →
-- consumed when its slot publishes. Nothing stopped a second
-- publish-existing call from scheduling the same upload id again, so the
-- second call answered "scheduled" and its slot failed at publish time,
-- after the caller had moved on. The web route now rejects that call
-- with 409 VIDEO_UPLOAD_SCHEDULED; this index is the race-proof backstop
-- for two concurrent calls.
--
-- A failed slot releases the reference (status <> 'failed'), so an upload
-- whose slot failed before its claim can be scheduled again. Cancelled
-- slots are deleted rows, so they release it too.
-- Idempotent (create ... if not exists).
-- ============================================================================

create unique index if not exists scheduled_posts_upload_media_ref_key
  on public.scheduled_posts (media_ref)
  where media_kind = 'upload' and status <> 'failed';
