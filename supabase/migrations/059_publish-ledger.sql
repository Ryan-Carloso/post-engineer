-- ============================================================================
-- 059 — Publish ledger: one recorded publish per (scope key, provider,
-- account).
--
-- The engine's 600s upload timeout can fire while the web route is still
-- publishing: the scheduler marks the account transient and retries 30s
-- later, and the retry would post a second identical video. The ledger
-- makes the retry answer from recorded state instead of posting again.
-- The first request claims the key (in_progress, 30-min lease, fenced by
-- a random token) and records its result when it finishes; a retry replays
-- the recorded post, waits for the in-flight attempt, or — after a failed
-- attempt or an expired lease — claims a fresh attempt. Only the request
-- that holds the lease can record, so a first attempt whose lease was
-- taken over cannot overwrite the winner's post. The lease is renewed by
-- the holder while it publishes (touch_publish_ledger, called on a
-- heartbeat by the route), so it only expires when the holder is gone:
-- a publish that runs longer than the lease — Fanvue is unbounded, up to
-- 256 parts at 10 min each — is never taken over while it is still alive.
-- Idempotent (CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE).
-- ============================================================================

create table if not exists public.publish_ledger (
  key text primary key,
  provider text not null,
  account_id text not null,
  user_id uuid not null,
  status text not null check (status in ('in_progress', 'published', 'failed')),
  lease_until timestamptz,
  claim_token text,
  result jsonb,
  error text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.publish_ledger enable row level security;

create or replace function public.claim_publish_ledger(
  p_key text,
  p_provider text,
  p_account_id text,
  p_user_id uuid,
  p_lease_seconds integer,
  p_token text
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_row public.publish_ledger%rowtype;
begin
  -- Lock the row first so concurrent claims serialize here.
  select * into v_row from public.publish_ledger where key = p_key for update;

  if not found then
    insert into public.publish_ledger (key, provider, account_id, user_id, status, lease_until, claim_token)
    values (p_key, p_provider, p_account_id, p_user_id, 'in_progress', now() + make_interval(secs => p_lease_seconds), p_token);
    return jsonb_build_object('outcome', 'claimed');
  end if;

  if v_row.status = 'published' then
    return jsonb_build_object('outcome', 'published', 'result', v_row.result);
  end if;

  if v_row.status = 'in_progress' and v_row.lease_until > now() then
    return jsonb_build_object('outcome', 'in_progress');
  end if;

  -- Failed, or in progress past its lease (no heartbeat for a full
  -- lease: the first request is gone — it died, or its process went
  -- away — without recording): this request takes over with a fresh
  -- lease and token.
  update public.publish_ledger
  set status = 'in_progress', lease_until = now() + make_interval(secs => p_lease_seconds),
      claim_token = p_token, result = null, error = null, error_code = null,
      updated_at = now()
  where key = p_key;
  return jsonb_build_object('outcome', 'claimed');
end;
$$;

create or replace function public.touch_publish_ledger(
  p_key text,
  p_token text,
  p_lease_seconds integer
)
returns boolean
language plpgsql
security definer
as $$
declare
  v_updated boolean;
begin
  -- The holder renews its own lease while it publishes. Only the token
  -- holder extends: a retry that no longer holds the lease cannot keep a
  -- dead attempt alive, and a finished attempt (status != in_progress)
  -- cannot be resurrected.
  update public.publish_ledger
  set lease_until = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  where key = p_key and claim_token = p_token and status = 'in_progress';
  v_updated := found;
  return v_updated;
end;
$$;

create or replace function public.record_publish_ledger(
  p_key text,
  p_token text,
  p_status text,
  p_result jsonb,
  p_error text,
  p_error_code text
)
returns boolean
language plpgsql
security definer
as $$
declare
  v_updated boolean;
begin
  -- Only the request that holds the lease records: a first attempt whose
  -- lease was taken over by a retry must not overwrite the winner's post.
  update public.publish_ledger
  set status = p_status, result = p_result, error = p_error, error_code = p_error_code,
      lease_until = null, updated_at = now()
  where key = p_key and claim_token = p_token and status = 'in_progress';
  v_updated := found;
  return v_updated;
end;
$$;

-- Trust boundary: these RPCs are publish infrastructure. Supabase grants
-- new functions to anon/authenticated through default privileges, so
-- revoking PUBLIC alone is not enough (025 convention). Guarded: vanilla
-- Postgres in CI has none of these roles.
do $$
begin
  revoke execute on function public.claim_publish_ledger(text, text, text, uuid, integer, text) from public;
  revoke execute on function public.touch_publish_ledger(text, text, integer) from public;
  revoke execute on function public.record_publish_ledger(text, text, text, jsonb, text, text) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.claim_publish_ledger(text, text, text, uuid, integer, text) from anon;
    revoke execute on function public.touch_publish_ledger(text, text, integer) from anon;
    revoke execute on function public.record_publish_ledger(text, text, text, jsonb, text, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.claim_publish_ledger(text, text, text, uuid, integer, text) from authenticated;
    revoke execute on function public.touch_publish_ledger(text, text, integer) from authenticated;
    revoke execute on function public.record_publish_ledger(text, text, text, jsonb, text, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.claim_publish_ledger(text, text, text, uuid, integer, text) to service_role;
    grant execute on function public.touch_publish_ledger(text, text, integer) to service_role;
    grant execute on function public.record_publish_ledger(text, text, text, jsonb, text, text) to service_role;
  end if;
end $$;
