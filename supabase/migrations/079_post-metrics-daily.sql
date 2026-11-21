-- ============================================================================
-- 079 — Daily cumulative metric readings (issue #618, slice a).
-- post_metrics holds one snapshot per life window of a video (24-48h, 7d,
-- 28d after publish), so "what happened in the last 24 hours" cannot be
-- answered from it. Provider counters are lifetime totals; the last 24h of
-- a video is the difference of two cumulative readings about a day apart.
--
-- post_metrics_daily: one reading per (post, provider, external video,
-- UTC snapshot_date). Counters are nullable like post_metrics (a provider
-- that does not report a metric stores null, never 0). The collector
-- upserts on the unique key, so a same-day re-run overwrites its own row.
-- Owners read their rows (policy matching post_metrics); writes come from
-- the service role only. The (post_id, provider, external_id, snapshot_date
-- desc) index serves "latest reading minus the reading 20-28h earlier".
--
-- post_metrics_daily_attempts: one row per (post, UTC date) once every
-- video of the post reached a terminal outcome that day (reading saved,
-- video gone, account unresolved, unknown provider, dead token). A post
-- whose videos were all skipped has no reading to show for the day, so
-- without this marker it would stay due on every run and fill the cap.
-- A transient failure (5xx, 429, timeout) leaves no marker and is retried.
--
-- find_post_metrics_daily_due: published posts from the last 28 days with
-- no attempt marker for the UTC date of p_now, plus the provider:external
-- keys already read today so a retry reads only the videos that are still
-- missing. Posts never read come first, then the post whose newest reading
-- is oldest, then oldest publish. Service role only (65 convention).
-- Idempotent.
-- ============================================================================

create table if not exists public.post_metrics_daily (
  id uuid not null default gen_random_uuid() primary key,
  post_id uuid not null,
  user_id uuid not null,
  provider text not null check (provider in ('youtube', 'instagram', 'bluesky', 'linkedin', 'threads', 'facebook', 'pinterest', '3speak', 'rumble', 'fanvue', 'telegram')),
  external_id text not null,
  snapshot_date date not null,
  views bigint,
  likes bigint,
  comments bigint,
  saves bigint,
  collected_at timestamptz not null default now(),
  unique (post_id, provider, external_id, snapshot_date)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.post_metrics_daily'::regclass
      and conname = 'post_metrics_daily_post_id_fkey'
  ) then
    alter table public.post_metrics_daily
      add constraint post_metrics_daily_post_id_fkey
      foreign key (post_id) references public.scheduled_posts(id) on delete cascade;
  end if;
end $$;

create index if not exists post_metrics_daily_user_date_idx
  on public.post_metrics_daily (user_id, snapshot_date desc);

create index if not exists post_metrics_daily_video_date_idx
  on public.post_metrics_daily (post_id, provider, external_id, snapshot_date desc);

alter table public.post_metrics_daily enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'post_metrics_daily'
      and policyname = 'post_metrics_daily_select_own'
  ) then
    create policy post_metrics_daily_select_own on public.post_metrics_daily
      for select using (auth.uid() = user_id);
  end if;
end $$;

create table if not exists public.post_metrics_daily_attempts (
  post_id uuid not null,
  snapshot_date date not null,
  attempted_at timestamptz not null default now(),
  primary key (post_id, snapshot_date)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.post_metrics_daily_attempts'::regclass
      and conname = 'post_metrics_daily_attempts_post_id_fkey'
  ) then
    alter table public.post_metrics_daily_attempts
      add constraint post_metrics_daily_attempts_post_id_fkey
      foreign key (post_id) references public.scheduled_posts(id) on delete cascade;
  end if;
end $$;

alter table public.post_metrics_daily_attempts enable row level security;

drop function if exists public.find_post_metrics_daily_due(timestamptz, integer);

create or replace function public.find_post_metrics_daily_due(p_now timestamptz, p_limit integer)
returns table (
  post_id uuid,
  user_id uuid,
  task_id text,
  published_at timestamptz,
  collected_keys text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    sp.id,
    sp.user_id,
    sp.task_id,
    sp.published_at,
    coalesce(
      (
        select array_agg(pmd.provider || ':' || pmd.external_id)
        from public.post_metrics_daily pmd
        where pmd.post_id = sp.id
          and pmd.snapshot_date = (p_now at time zone 'UTC')::date
      ),
      '{}'
    )
  from public.scheduled_posts sp
  where sp.status = 'published'
    and sp.task_id is not null
    and sp.published_at > p_now - interval '28 days'
    and sp.published_at <= p_now
    and not exists (
      select 1 from public.post_metrics_daily_attempts pda
      where pda.post_id = sp.id
        and pda.snapshot_date = (p_now at time zone 'UTC')::date
    )
  order by
    (select max(pmd.collected_at) from public.post_metrics_daily pmd where pmd.post_id = sp.id) asc nulls first,
    sp.published_at asc,
    sp.id asc
  limit p_limit;
$$;

do $$
begin
  revoke execute on function public.find_post_metrics_daily_due(timestamptz, integer) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.find_post_metrics_daily_due(timestamptz, integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.find_post_metrics_daily_due(timestamptz, integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.find_post_metrics_daily_due(timestamptz, integer) to service_role;
  end if;
end $$;
