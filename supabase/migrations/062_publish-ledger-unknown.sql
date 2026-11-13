-- ============================================================================
-- 062 — Publish ledger: park a lost record as 'unknown'.
--
-- Migration 061 closed the duplicate on a publish timeout: a retry replays
-- the recorded post instead of posting again. One hole stayed open: the
-- post succeeds but the record RPC fails (and the engine times out too),
-- so the retry finds no recorded result and — once the 30-min lease
-- expires — claims a fresh attempt and posts a second identical video.
--
-- 'unknown' closes it. When a success cannot be recorded even after the
-- route's bounded retries, the claim is parked as unknown instead of left
-- in_progress: the post may already be live, so claim_publish_ledger
-- never grants a fresh publish over an unknown row, and the retry answers
-- 'publish_unknown' — the engine parks the account (failed, needs the
-- user to verify the post on the provider, no token refund) instead of
-- re-posting. A failed result that cannot be recorded is NOT parked:
-- nothing was published, so the lease expiry stays the safe recovery.
-- Idempotent (guarded constraint swap, CREATE OR REPLACE).
-- ============================================================================

-- Admit 'unknown' alongside the 061 statuses.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'publish_ledger_status_check') then
    alter table public.publish_ledger drop constraint publish_ledger_status_check;
  end if;
  alter table public.publish_ledger
    add constraint publish_ledger_status_check
    check (status in ('in_progress', 'published', 'failed', 'unknown'));
end $$;

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
  v_attempt integer;
begin
  -- Lock the row first so concurrent claims serialize here.
  -- SELECT ... FOR UPDATE locks nothing when the row does not exist yet,
  -- so two first-time claims can both reach the INSERT. ON CONFLICT DO
  -- NOTHING lets the loser re-read the winner's row and fall through to
  -- the replay/wait logic instead of 500ing on a unique violation. The
  -- loop bounds the retries: each pass needs a concurrent claim that
  -- then rolls back before the re-read.
  for v_attempt in 1..3 loop
    select * into v_row from public.publish_ledger where key = p_key for update;

    -- The key is caller-supplied, so the row is fenced to the user who
    -- claimed it: another user who learns the key can neither replay the
    -- recorded post, nor poll whether a publish is in flight, nor park
    -- the owner's retry by holding the lease first.
    if found then
      if v_row.user_id <> p_user_id then
        return jsonb_build_object('outcome', 'forbidden');
      end if;
      exit;
    end if;

    insert into public.publish_ledger (key, provider, account_id, user_id, status, lease_until, claim_token)
    values (p_key, p_provider, p_account_id, p_user_id, 'in_progress', now() + make_interval(secs => p_lease_seconds), p_token)
    on conflict (key) do nothing;
    if found then
      return jsonb_build_object('outcome', 'claimed');
    end if;
  end loop;
  if not found then
    raise exception 'claim_publish_ledger: key % never materialized', p_key;
  end if;

  if v_row.status = 'published' then
    return jsonb_build_object('outcome', 'published', 'result', v_row.result);
  end if;

  -- Parked as unknown: the post may already be live, so no retry may
  -- ever claim a fresh publish over this row. The caller answers
  -- 'publish_unknown' instead, and the account waits for a human to
  -- verify the post on the provider first.
  if v_row.status = 'unknown' then
    return jsonb_build_object('outcome', 'unknown');
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

create or replace function public.mark_publish_unknown(
  p_key text,
  p_token text,
  p_error text
)
returns boolean
language plpgsql
security definer
as $$
declare
  v_updated boolean;
begin
  -- Only the request that holds the lease parks: a retry that no longer
  -- holds the lease cannot park the winner's row, and a finished attempt
  -- (status != in_progress) cannot be parked after the fact.
  update public.publish_ledger
  set status = 'unknown', error = p_error, lease_until = null, updated_at = now()
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
  revoke execute on function public.mark_publish_unknown(text, text, text) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.mark_publish_unknown(text, text, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.mark_publish_unknown(text, text, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.mark_publish_unknown(text, text, text) to service_role;
  end if;
end $$;
