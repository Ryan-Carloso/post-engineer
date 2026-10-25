-- 028: publish retry backoff (PR-B of issue #277).
--
-- When a slot's publish fails below MAX_PUBLISH_ATTEMPTS, the publisher
-- returns it to 'ready' with a `publish_not_before` timestamp (30s after the
-- first failure, 2min after the second — see
-- app/services/fill_schedule/constants.py PUBLISH_RETRY_DELAY_SECONDS).
-- `ready_due_slots` skips the slot until the delay elapses, so a failing
-- upload endpoint is re-attempted inside its recovery window instead of on
-- every scheduler tick. Old rows (and freshly created slots) carry NULL,
-- which means "due now".

alter table public.scheduled_posts
  add column if not exists publish_not_before timestamptz;

create index if not exists scheduled_posts_publish_not_before_idx
  on public.scheduled_posts (publish_not_before);
