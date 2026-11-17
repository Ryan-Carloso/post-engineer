-- ============================================================================
-- 067 — One schedulable slot per signed upload (issue #384 follow-up).
--
-- A signed video upload is single-use: the engine claims it ready →
-- consumed when its slot publishes. Nothing stopped a second
-- publish-existing call from scheduling the same upload id again, so the
-- second call answered "scheduled" and its slot failed at publish time,
-- after the caller had moved on. The web route now rejects that call
-- with 409 VIDEO_UPLOAD_SCHEDULED; this index is the race-proof backstop
-- for two concurrent calls.
--
-- The index covers only the rows a new call can collide with, `pending`
-- and `ready`. Those are the statuses an existing-media slot is inserted
-- with (`buildSlotRows` writes pending, the publish-existing route rewrites
-- it to ready). A slot that left them is not a reference a second schedule
-- can take: `failed` released it, and `publishing`/`published` mean the
-- upload was already claimed or consumed, which the route's own
-- `assertUploadNotScheduled` still answers 409 for.
--
-- Restricting the index is also what keeps this migration from touching
-- history. Production already holds slots from those double calls, and
-- CREATE UNIQUE INDEX aborts (23505) on them. Only one of a duplicate group
-- can ever publish the single-use upload, so the rest are unreachable: no
-- tokens were charged for an existing-media slot (charged_tokens = 0), so
-- nothing is refunded and the duplicate rows go. A schedule whose every
-- slot was such a duplicate is left empty, so it goes with them. Published
-- and in-flight rows are never deleted: `post_metrics` cascades from the
-- slot, so deleting a published one would erase the post's record.
-- Idempotent (the delete finds nothing on a second run, create ... if not
-- exists).
-- ============================================================================

with ranked as (
  -- Keep the earliest slot of each upload: the upload publishes as early as
  -- the caller first asked. Ties fall back to creation order, then id.
  select
    id,
    schedule_id,
    row_number() over (
      partition by media_ref
      order by slot_at, created_at, id
    ) as rank
  from public.scheduled_posts
  where media_kind = 'upload' and status in ('pending', 'ready')
),
doomed as (
  select id, schedule_id from ranked where rank > 1
),
removed as (
  delete from public.scheduled_posts slot
  using doomed
  where slot.id = doomed.id
    -- Re-checked on the locked row: an engine claim (ready → publishing)
    -- that commits first must win, never be deleted mid-publish.
    and slot.media_kind = 'upload'
    and slot.status in ('pending', 'ready')
  returning slot.schedule_id
)
delete from public.schedules schedule
using removed
where schedule.id = removed.schedule_id
  and not exists (
    -- Sibling CTEs share the pre-delete snapshot, so a surviving slot is
    -- one that is not being deleted by this statement.
    select 1
    from public.scheduled_posts survivor
    where survivor.schedule_id = schedule.id
      and survivor.id not in (select id from doomed)
  );

create unique index if not exists scheduled_posts_upload_media_ref_key
  on public.scheduled_posts (media_ref)
  where media_kind = 'upload' and status in ('pending', 'ready');
