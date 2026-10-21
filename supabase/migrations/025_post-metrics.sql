-- ============================================================================
-- Migration 025 — Per-video performance metrics
-- ----------------------------------------------------------------------------
-- WHY: to tell which content works (A/B tests on hook angle, CTA, script
-- style) we need each published video's own numbers. Until now only
-- channel-level statistics were read.
--
-- WHAT:
--   1. public.post_metrics — one snapshot per (post, provider video, window).
--      Windows: '24h' (collected 24-48h after publish) and '7d' (168-192h).
--      Counters are nullable: a provider that does not report a metric
--      stores null, never a fake 0.
--   2. public.find_post_metrics_due() — the posts each cron run measures.
--   3. public.schedule_post_metrics() — wires an hourly pg_cron job that
--      POSTs the web cron endpoint /api/cron/post-metrics. Same contract as
--      migration 004: runs only when pg_cron/pg_net are available AND
--      app.cron_base_url/app.cron_secret are set; otherwise a NOTICE.
--
-- One-time production setup (after app.cron_base_url/app.cron_secret from
-- migration 004 are set):
--   select public.schedule_post_metrics();
--
-- Idempotent: safe to re-run (IF NOT EXISTS / guarded policies / unschedule
-- before schedule).
-- ============================================================================

create table if not exists public.post_metrics (
  id uuid not null default gen_random_uuid() primary key,
  post_id uuid not null references public.scheduled_posts(id) on delete cascade,
  user_id uuid not null,
  provider text not null check (provider in ('youtube', 'instagram')),
  account_id text not null,
  external_id text not null,
  metrics_window text not null check (metrics_window in ('24h', '7d')),
  views bigint,
  likes bigint,
  comments bigint,
  saves bigint,
  collected_at timestamptz not null default now(),
  unique (post_id, provider, external_id, metrics_window)
);

create index if not exists post_metrics_user_id_idx
  on public.post_metrics (user_id, collected_at desc);

-- RLS: owners read their own metrics. Writes happen only from the web cron
-- route with the service role (which bypasses RLS).
alter table public.post_metrics enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'post_metrics'
      and policyname = 'post_metrics_select_own'
  ) then
    create policy post_metrics_select_own on public.post_metrics
      for select using (auth.uid() = user_id);
  end if;
end $$;

-- find_post_metrics_due — published posts inside an open snapshot window
-- that still miss at least one snapshot for it. "Missing" is decided per
-- post here (no row yet for that window); the web re-checks per video, so a
-- post where one provider failed is retried until its window closes.
-- Windows: '24h' = 24-48h after publish, '7d' = 168-192h after publish.
-- Called only by the web cron route with the service role.
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
    values ('24h', 24), ('7d', 168)
  ),
  due as (
    select sp.id, sp.user_id, sp.task_id, sp.published_at, w.metrics_window
    from public.scheduled_posts sp
    join windows w
      on sp.published_at <= p_now - make_interval(hours => w.start_hours)
     and sp.published_at > p_now - make_interval(hours => w.start_hours + 24)
    where sp.status = 'published'
      and sp.task_id is not null
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
        where pm.post_id = d.id and pm.metrics_window = d.metrics_window
      ),
      '{}'
    )
  from due d
  order by
    -- Posts with no snapshot at all for the window go first, so a backlog
    -- of partially collected posts can never starve fresh ones.
    exists (
      select 1 from public.post_metrics pm
      where pm.post_id = d.id and pm.metrics_window = d.metrics_window
    ),
    d.published_at
  limit p_limit;
$$;

-- Trust boundary: reads every user's posts, so it is cron/service-role
-- only. Supabase grants new functions to anon/authenticated through default
-- privileges, so revoking PUBLIC alone is not enough. Guarded: vanilla
-- Postgres in CI has none of these roles.
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

create or replace function public.schedule_post_metrics()
returns boolean
language plpgsql
as $$
declare
  base_url text := current_setting('app.cron_base_url', true);
  cron_secret text := current_setting('app.cron_secret', true);
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'post-metrics: pg_cron/pg_net not available; hourly schedule skipped';
    return false;
  end if;
  if base_url is null or base_url = '' or cron_secret is null or cron_secret = '' then
    raise notice 'post-metrics: app.cron_base_url/app.cron_secret not set; hourly schedule skipped';
    return false;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    create extension pg_cron;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    create extension pg_net;
  end if;
  -- pg_cron and pg_net live in their own schemas (cron, net); qualify
  -- explicitly since the job runs with a default search_path.
  -- cron.unschedule raises when the job does not exist yet (first run).
  if exists (select 1 from cron.job where jobname = 'post-metrics-hourly') then
    perform cron.unschedule('post-metrics-hourly');
  end if;
  perform cron.schedule(
    'post-metrics-hourly',
    '17 * * * *',
    format(
      'select net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb)',
      base_url || '/api/cron/post-metrics',
      jsonb_build_object(
        'Authorization', 'Bearer ' || cron_secret,
        'Content-Type', 'application/json'
      )::text,
      '{}'
    )
  );
  raise notice 'post-metrics: hourly pg_cron job scheduled';
  return true;
end;
$$;

-- Best-effort wiring at migration time: no-ops with a NOTICE when the
-- extensions or settings are missing (vanilla Postgres in CI).
do $$
begin
  perform public.schedule_post_metrics();
end $$;
