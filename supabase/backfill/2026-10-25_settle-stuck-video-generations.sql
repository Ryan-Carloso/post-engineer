-- 2026-10-25 backfill: settle video_generations rows that the 2026-10 engine
-- 404/restart incidents left "running" or falsely "failed".
--
-- MANUAL ONLY. Deliberately not a migration (deploy.yml applies migrations
-- automatically): this rewrites production history rows and must be run once,
-- after review and with Ryan's explicit approval.
--
--   psql "$SUPABASE_DB_URL" -f supabase/backfill/2026-10-25_settle-stuck-video-generations.sql
--
-- Evidence (production, 2026-10-24/25):
--   * 9 video_generations rows are "running" for days (some from 10-20), 5 of
--     them with published scheduled_posts and completed, video-bearing
--     engine_task_state rows.
--   * 5 rows were wrongly "failed"/"engine_restart" while the engine task was
--     complete with a videos[] payload ("the video task no longer exists..."
--     verdict written during an engine 404 window on 10-22 17:17 UTC).
--   * 0 rows ever reach "completed" (the poll path is the only writer, and the
--     internal billing-reconcile scheduler produced no lease rows and no
--     scheduler_started events).
--
-- Rules (mirrors apps/web/lib/generation/gone-settle.ts + billing/reconcile.ts):
--   * durable engine_task_state.state = 1 (COMPLETE) WITH a persisted
--     data->videos render, owned by the same user_id, and
--   * OR a published scheduled_posts slot naming the task,
--   means delivered value → status 'completed', error detail cleared. The
--     completed stamp is completed_at = now() — we cannot know the true
--     completion time for rows the poll path never observed, so say so in the
--     error_message... kept null because completed is terminal and honest
--     here; the created_at column keeps the audit trail.
--   * everything else stays untouched: dead work must keep its failed/
--     engine_restart record and its reconcile refund rules.
--
-- Idempotent: re-running is a no-op.

begin;

-- 1) stuck running rows whose video provably exists
update public.video_generations v
set status = 'completed',
    error_code = null,
    error_message = null,
    completed_at = now(),
    updated_at = now()
where v.status in ('pending', 'running')
  and (
    exists (
      select 1 from public.engine_task_state t
      where t.task_id = v.engine_task_id
        and t.user_id = v.user_id::text
        and t.state = 1
        and jsonb_array_length(coalesce(t.data->'videos', '[]'::jsonb)) > 0
    )
    or exists (
      select 1 from public.scheduled_posts sp
      where sp.task_id = v.engine_task_id
        and sp.user_id = v.user_id
        and sp.status = 'published'
    )
  );

-- 2) rows a false "gone" verdict failed while the durable state (or a
--    published slot) proves the video finished
update public.video_generations v
set status = 'completed',
    error_code = null,
    error_message = null,
    completed_at = now(),
    updated_at = now()
where v.status = 'failed'
  and (
    exists (
      select 1 from public.engine_task_state t
      where t.task_id = v.engine_task_id
        and t.user_id = v.user_id::text
        and t.state = 1
        and jsonb_array_length(coalesce(t.data->'videos', '[]'::jsonb)) > 0
    )
    or exists (
      select 1 from public.scheduled_posts sp
      where sp.task_id = v.engine_task_id
        and sp.user_id = v.user_id
        and sp.status = 'published'
    )
  );

commit;

-- Preview before running (read-only):
--
--   select v.status, count(*)
--   from video_generations v
--   where v.status in ('pending','running','failed')
--   and (
--     exists (select 1 from engine_task_state t where t.task_id = v.engine_task_id
--             and t.user_id = v.user_id::text and t.state = 1
--             and jsonb_array_length(coalesce(t.data->'videos','[]'::jsonb)) > 0)
--     or exists (select 1 from scheduled_posts sp where sp.task_id = v.engine_task_id
--             and sp.user_id = v.user_id and sp.status = 'published')
--   )
--   group by v.status;
