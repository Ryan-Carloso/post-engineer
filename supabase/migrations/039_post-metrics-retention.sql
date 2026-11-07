-- ============================================================================
-- 039 — YouTube retention columns on post_metrics + a '28d' snapshot window.
--
-- Since 2026-08-24 YouTube counts a view the moment playback starts, so the
-- Data API view count no longer says whether the hook held. The web reads
-- the YouTube Analytics API (yt-analytics.readonly) for the user's own
-- videos and stores, per snapshot:
--   analytics_views / engaged_views   views and engaged views over
--                                     [analytics_start_date, analytics_end_date]
--   average_view_duration_seconds / average_view_percentage
--   content_type                      raw creatorContentType (SHORTS,
--                                     VIDEO_ON_DEMAND, LIVE_STREAM, ...)
--   analytics_status                  ok | scope_missing (token predates the
--                                     scope: reconnect) | not_owned (video is
--                                     not on the account's channel: never
--                                     queried) | no_data (Analytics returned
--                                     no rows)
-- All nullable: null = not YouTube, or not collected.
--
-- Analytics data stays provisional for ~48-72h, so a '28d' window (672-696h
-- after publish) joins '24h' and '7d' on the same hourly job; the web queries
-- it up to collection date - 3 days, so its values are final.
-- Idempotent.
-- ============================================================================

alter table public.post_metrics
  add column if not exists analytics_views bigint,
  add column if not exists engaged_views bigint,
  add column if not exists average_view_duration_seconds numeric,
  add column if not exists average_view_percentage numeric,
  add column if not exists content_type text,
  add column if not exists analytics_start_date date,
  add column if not exists analytics_end_date date,
  add column if not exists analytics_status text;

alter table public.post_metrics
  drop constraint if exists post_metrics_analytics_status_check;

alter table public.post_metrics
  add constraint post_metrics_analytics_status_check
  check (analytics_status in ('ok', 'scope_missing', 'not_owned', 'no_data'));

-- The 025 window checks were declared inline (auto-named), so drop every
-- check on either table that mentions metrics_window, then add one named
-- check with the three windows.
do $$
declare
  c record;
begin
  for c in
    select con.conname, rel.relname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname in ('post_metrics', 'post_metrics_done')
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%metrics_window%'
  loop
    execute format('alter table public.%I drop constraint %I', c.relname, c.conname);
  end loop;
end $$;

alter table public.post_metrics
  add constraint post_metrics_metrics_window_check
  check (metrics_window in ('24h', '7d', '28d'));

alter table public.post_metrics_done
  add constraint post_metrics_done_metrics_window_check
  check (metrics_window in ('24h', '7d', '28d'));

-- find_post_metrics_due — unchanged from 025 except the '28d' window.
-- Windows: '24h' = 24-48h, '7d' = 168-192h, '28d' = 672-696h after publish.
create or replace function public.find_post_metrics_due(p_now timestamptz, p_limit integer)
returns table (
  post_id uuid,
  user_id uuid,
  task_id text,
  published_at timestamptz,
  metrics_window text,
  collected_keys text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with windows(metrics_window, start_hours) as (
    values ('24h', 24), ('7d', 168), ('28d', 672)
  ),
  due as (
    select sp.id, sp.user_id, sp.task_id, sp.published_at, w.metrics_window
    from public.scheduled_posts sp
    join windows w
      on sp.published_at <= p_now - make_interval(hours => w.start_hours)
     and sp.published_at > p_now - make_interval(hours => w.start_hours + 24)
    where sp.status = 'published'
      and sp.task_id is not null
      and not exists (
        select 1 from public.post_metrics_done pmd
        where pmd.post_id = sp.id and pmd.metrics_window = w.metrics_window
      )
  )
  select
    d.id,
    d.user_id,
    d.task_id,
    d.published_at,
    d.metrics_window,
    coalesce(
      (
        select array_agg(pm.provider || ':' || pm.external_id)
        from public.post_metrics pm
        where pm.post_id = d.id
          and pm.metrics_window = d.metrics_window
          -- A YouTube snapshot collected without the Analytics scope (or
          -- before these columns existed) is not "collected": the hourly
          -- run retries it until the token is reconnected or the window
          -- closes, so retention is not lost for the whole video.
          and not (
            pm.provider = 'youtube'
            and (pm.analytics_status is null or pm.analytics_status = 'scope_missing')
          )
      ),
      '{}'
    )
  from due d
  order by
    exists (
      select 1 from public.post_metrics pm
      where pm.post_id = d.id and pm.metrics_window = d.metrics_window
    ),
    d.published_at
  limit p_limit;
$$;

-- reset_post_metrics_windows — clears the done marks of a YouTube channel
-- whose snapshots have no Analytics scope (or predate the Analytics
-- columns), so reconnecting the channel re-collects every window that is
-- still inside its age range. A closed window can never be back-filled, so
-- its stale scope_missing row stops asking for a reconnect and becomes
-- no_data ("Retention n/a"). Scoped to the account's own snapshots.
create or replace function public.reset_post_metrics_windows(p_user_id uuid, p_account_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.post_metrics_done pmd
  using public.post_metrics pm
  where pmd.post_id = pm.post_id
    and pmd.metrics_window = pm.metrics_window
    and pm.user_id = p_user_id
    and pm.provider = 'youtube'
    and pm.account_id = p_account_id
    and (pm.analytics_status is null or pm.analytics_status = 'scope_missing');

  update public.post_metrics pm
  set analytics_status = 'no_data'
  where pm.user_id = p_user_id
    and pm.provider = 'youtube'
    and pm.account_id = p_account_id
    and pm.analytics_status = 'scope_missing'
    and not exists (
      select 1
      from public.scheduled_posts sp
      join (values ('24h', 24), ('7d', 168), ('28d', 672)) w(metrics_window, start_hours)
        on w.metrics_window = pm.metrics_window
      where sp.id = pm.post_id
        and sp.published_at <= now() - make_interval(hours => w.start_hours)
        and sp.published_at > now() - make_interval(hours => w.start_hours + 24)
    );
end;
$$;

-- create or replace keeps grants, but re-assert them: cron/service-role only.
do $$
begin
  revoke execute on function public.find_post_metrics_due(timestamptz, integer) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.find_post_metrics_due(timestamptz, integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.find_post_metrics_due(timestamptz, integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.find_post_metrics_due(timestamptz, integer) to service_role;
  end if;
end $$;

-- Reconnecting a channel is a service-role action: the web OAuth callback
-- calls this with the service client (post_metrics_done has no RLS policy).
do $$
begin
  revoke execute on function public.reset_post_metrics_windows(uuid, text) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.reset_post_metrics_windows(uuid, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.reset_post_metrics_windows(uuid, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.reset_post_metrics_windows(uuid, text) to service_role;
  end if;
end $$;
