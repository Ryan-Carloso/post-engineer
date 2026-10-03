-- 004_billing_reconcile.sql
--
-- Billing reconciliation: zombie schedule detectors + the stuck-generation
-- review queue.
--
-- Adds (all idempotent, non-destructive):
--   1. public.refund_reviews — human review queue for ambiguous stuck
--      video generations. RLS enabled with no permissive policies: only
--      the service_role client (admin-verified routes) touches it.
--   2. public.find_zombie_schedule_candidates(p_cutoff) — detector for
--      schedules older than p_cutoff with zero scheduled_posts, zero
--      video_generations, and a ledger spend under the batch:<schedule_id>
--      generation id. A schedule matching this is provably worthless.
--   3. public.find_stuck_generations(p_cutoff) — detector for
--      video_generations stuck in a non-terminal status past p_cutoff
--      that were never refunded.
--   4. public.schedule_billing_reconcile() — wires the daily pg_cron job
--      that POSTs the web cron endpoint. Runs only when pg_cron/pg_net
--      are installed AND app.cron_base_url/app.cron_secret are set;
--      otherwise it raises a NOTICE and the daily run stays unwired (the
--      fallback is documented in the PR description).
--
-- One-time production setup (as the postgres role, after this migration):
--   alter database postgres set app.cron_base_url = 'https://<web-host>';
--   alter database postgres set app.cron_secret = '<CRON_SECRET>';
--   select public.schedule_billing_reconcile();

-- 1. Review queue -------------------------------------------------------
create table if not exists public.refund_reviews (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null,
  kind text not null default 'stuck_generation',
  ref_id text not null,
  tokens numeric not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

-- One pending review per generation: concurrent reconcile runs can never
-- double-queue the same stuck job.
create unique index if not exists refund_reviews_pending_unique
  on public.refund_reviews (kind, ref_id)
  where status = 'pending';

create index if not exists refund_reviews_status_idx
  on public.refund_reviews (status, created_at desc);

-- Locked down: no permissive policies, so only the service_role client
-- (used exclusively by admin-verified routes) can read/write.
alter table public.refund_reviews enable row level security;

-- 2. Zombie schedule detector --------------------------------------------
-- A zombie is a schedule that can never produce value: old enough that
-- dispatch would long have happened, zero slots, zero video_generations
-- rows, but a ledger spend under the unified flow's batch:<schedule_id>
-- generation id. The refund itself goes through the idempotent
-- refund_generation_tokens RPC (called by the web cron route), so
-- re-running detection is always safe.
create or replace function public.find_zombie_schedule_candidates(p_cutoff timestamptz)
returns table (
  schedule_id uuid,
  user_id uuid,
  generation_id text,
  tokens_spent numeric,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.user_id,
    ('batch:' || s.id::text),
    (
      select max(abs(t.amount))
      from public.token_transactions t
      where t.user_id = s.user_id
        and t.generation_id = 'batch:' || s.id::text
    ),
    s.created_at
  from public.schedules s
  where s.created_at < p_cutoff
    and not exists (
      select 1 from public.scheduled_posts sp where sp.schedule_id = s.id
    )
    and not exists (
      select 1 from public.video_generations v
      where v.user_id = s.user_id
        and v.generation_id like 'batch:' || s.id::text || '%'
    )
    and exists (
      select 1 from public.token_transactions t
      where t.user_id = s.user_id
        and t.generation_id = 'batch:' || s.id::text
    );
$$;

-- 3. Stuck generation detector --------------------------------------------
-- video_generations rows stuck in a non-terminal status past the cutoff
-- that were never refunded. The web cron route verifies each against the
-- live engine task before deciding: provably dead -> auto-refund,
-- anything ambiguous -> refund_reviews.
create or replace function public.find_stuck_generations(p_cutoff timestamptz)
returns table (
  generation_pk uuid,
  user_id uuid,
  generation_id text,
  engine_task_id text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    v.id,
    v.user_id,
    v.generation_id,
    v.engine_task_id,
    v.created_at
  from public.video_generations v
  where v.status in ('pending', 'running')
    and v.created_at < p_cutoff
    and v.tokens_refunded = false;
$$;

-- Trust boundary: the detectors are cron/service-role only. Strip PUBLIC
-- execute where the Supabase roles exist (vanilla Postgres in CI has no
-- service_role, so this is a guarded no-op there); the service_role web
-- route keeps access via its explicit grant.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke execute on function public.find_zombie_schedule_candidates(timestamptz) from public;
    revoke execute on function public.find_stuck_generations(timestamptz) from public;
    grant execute on function public.find_zombie_schedule_candidates(timestamptz) to service_role;
    grant execute on function public.find_stuck_generations(timestamptz) to service_role;
  end if;
end
$$;

-- 4. Daily schedule --------------------------------------------------------
-- Wires (idempotently) the pg_cron job that triggers the web
-- reconciliation endpoint. Safe to re-run: it unschedules first.
create or replace function public.schedule_billing_reconcile()
returns boolean
language plpgsql
as $$
declare
  base_url text := current_setting('app.cron_base_url', true);
  cron_secret text := current_setting('app.cron_secret', true);
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'billing-reconcile: pg_cron/pg_net not available; daily schedule skipped (fallback in the PR description)';
    return false;
  end if;
  if base_url is null or base_url = '' or cron_secret is null or cron_secret = '' then
    raise notice 'billing-reconcile: app.cron_base_url/app.cron_secret not set; daily schedule skipped';
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
  perform cron.unschedule('billing-reconcile-daily');
  perform cron.schedule(
    'billing-reconcile-daily',
    '0 3 * * *',
    format(
      'select net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb)',
      base_url || '/api/cron/billing-reconcile',
      jsonb_build_object(
        'Authorization', 'Bearer ' || cron_secret,
        'Content-Type', 'application/json'
      )::text,
      '{}'
    )
  );
  raise notice 'billing-reconcile: daily pg_cron job scheduled';
  return true;
end;
$$;

-- Best-effort wiring at migration time: no-ops with a NOTICE when the
-- extensions or settings are missing (vanilla Postgres in CI, or prod
-- before the one-time setup above). Re-run
-- select public.schedule_billing_reconcile(); after setting them.
do $$
begin
  perform public.schedule_billing_reconcile();
end
$$;
