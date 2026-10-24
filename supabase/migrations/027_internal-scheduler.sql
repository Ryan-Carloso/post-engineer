-- 027_internal-scheduler.sql
--
-- The in-app scheduler replaces the pg_cron + pg_net HTTP triggering of
-- the web cron routes:
--   1. unschedules the two pg_cron jobs (guarded: skipped with a NOTICE
--      when the cron schema or the job does not exist — vanilla Postgres
--      in CI never created them);
--   2. drops the schedule_* wiring functions they used
--      (public.schedule_post_metrics from 025,
--      public.schedule_billing_reconcile from 004) and their helpers'
--      grants;
--   3. adds public.scheduler_leases + the lease RPCs the web app's
--      in-process scheduler uses to run each job at most once per tick
--      across replicas and to persist each job's last successful run
--      (the restart-safe due-check input): try_acquire_scheduler_lease,
--      get_scheduler_last_success, record_scheduler_success
--      (apps/web/lib/scheduler.ts, apps/web/lib/scheduler-lease.ts).
--      Jobs themselves (find_post_metrics_due, the reconcile SQL
--      detectors) are unchanged and keep working from the web app.
--
-- The one-time `alter database ... set app.cron_base_url/app.cron_secret`
-- settings from 004/025 are harmless leftovers now (nothing reads them
-- anymore); reset them manually on the server if you want:
--   alter database postgres reset app.cron_base_url;
--   alter database postgres reset app.cron_secret;

-----------------
-- 1. Unschedule the pg_cron jobs (each guarded; the cron schema itself
-- may not exist).
-----------------
do $$
begin
  begin
    if exists (select 1 from cron.job where jobname = 'post-metrics-hourly') then
      perform cron.unschedule('post-metrics-hourly');
      raise notice 'unscheduled pg_cron job post-metrics-hourly';
    end if;
  exception when undefined_table or undefined_object then
    raise notice 'pg_cron not available; post-metrics-hourly unschedule skipped';
  end;
  begin
    if exists (select 1 from cron.job where jobname = 'billing-reconcile-daily') then
      perform cron.unschedule('billing-reconcile-daily');
      raise notice 'unscheduled pg_cron job billing-reconcile-daily';
    end if;
  exception when undefined_table or undefined_object then
    raise notice 'pg_cron not available; billing-reconcile-daily unschedule skipped';
  end;
end $$;

-----------------
-- 2. Drop the schedule_* wiring functions (guarded).
-----------------
drop function if exists public.schedule_post_metrics();
drop function if exists public.schedule_billing_reconcile();

-----------------
-- 3. Lease table + atomic acquisition. The lease is a single INSERT ...
-- ON CONFLICT DO UPDATE ... WHERE lease_until <= now(): Postgres
-- serializes concurrent writers on the row, so with N replicas exactly
-- one returns true per tick. The losing replica's WHERE re-check sees
-- the fresh lease_until and returns false. TTL expiry lets a crashed
-- replica's lease lapse instead of blocking forever.
--
-- last_success_at is the restart-safe due-check input: the web app
-- checks it every tick (hourly) and runs the job when it is NULL (first
-- run at startup / catch-up after downtime) or when
-- now - last_success_at >= the job's due gap (1h post-metrics, 24h
-- billing). A restart resets nothing — no more postponed daily runs.
--
-- Service role only: RLS on, no policy (mirrors post_metrics_done, 025);
-- the RPCs follow the repo convention (004/025): revoked from
-- public/anon/authenticated (Supabase default-privileges new functions
-- to anon/authenticated, so revoking PUBLIC alone is not enough),
-- granted to service_role only.
-----------------
create table if not exists public.scheduler_leases (
  job text primary key,
  lease_until timestamptz not null,
  holder text not null,
  last_success_at timestamptz
);
alter table public.scheduler_leases enable row level security;

create or replace function public.try_acquire_scheduler_lease(
  p_job text,
  p_ttl_seconds integer,
  p_holder text
)
returns boolean
language plpgsql
as $$
begin
  insert into public.scheduler_leases (job, lease_until, holder)
  values (p_job, now() + make_interval(secs => p_ttl_seconds), p_holder)
  on conflict (job) do update
    set lease_until = excluded.lease_until,
        holder = excluded.holder
    where public.scheduler_leases.lease_until <= now();
  return found;
end;
$$;

create or replace function public.get_scheduler_last_success(p_job text)
returns timestamptz
language sql
stable
as $$
  select last_success_at from public.scheduler_leases where job = p_job;
$$;

create or replace function public.record_scheduler_success(p_job text)
returns void
language sql
as $$
  update public.scheduler_leases set last_success_at = now() where job = p_job;
$$;

-- Trust boundary: these RPCs are scheduler infrastructure. Supabase
-- grants new functions to anon/authenticated through default privileges,
-- so revoking PUBLIC alone is not enough (025 convention). Guarded:
-- vanilla Postgres in CI has none of these roles.
do $$
begin
  revoke execute on function public.try_acquire_scheduler_lease(text, integer, text) from public;
  revoke execute on function public.get_scheduler_last_success(text) from public;
  revoke execute on function public.record_scheduler_success(text) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.try_acquire_scheduler_lease(text, integer, text) from anon;
    revoke execute on function public.get_scheduler_last_success(text) from anon;
    revoke execute on function public.record_scheduler_success(text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.try_acquire_scheduler_lease(text, integer, text) from authenticated;
    revoke execute on function public.get_scheduler_last_success(text) from authenticated;
    revoke execute on function public.record_scheduler_success(text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.try_acquire_scheduler_lease(text, integer, text) to service_role;
    grant execute on function public.get_scheduler_last_success(text) to service_role;
    grant execute on function public.record_scheduler_success(text) to service_role;
  end if;
end $$;
