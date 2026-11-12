-- ============================================================================
-- Migration 059 — Owner alert notices
-- ----------------------------------------------------------------------------
-- One row per (user, dedup key) so a broken connected account, a failed
-- generation, or a failed publish emails the owner at most once per window.
-- Account breaks use a 7-day window. Generation and publish use a null
-- window (once, until the row is released after a failed send).
--
-- service_role only. RLS is on and there are no policies, same as
-- engine_task_state: the user client cannot read or clear these rows.
-- Reconnecting an account does not reset the window; a new account row
-- gets a new id and therefore a new key.
-- ============================================================================

create table if not exists public.owner_alert_notices (
  user_id uuid not null,
  dedup_key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, dedup_key)
);

alter table public.owner_alert_notices enable row level security;

-- claim_owner_alert — true when this caller won the send.
-- p_window_days null: insert once (conflict does nothing).
-- p_window_days > 0: insert, or refresh sent_at when the row is older
-- than that many days. A fresh row returns false.
create or replace function public.claim_owner_alert(
  p_user_id uuid,
  p_dedup_key text,
  p_window_days integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed boolean := false;
begin
  if p_user_id is null or p_dedup_key is null or length(btrim(p_dedup_key)) = 0 then
    return false;
  end if;
  if p_window_days is not null and p_window_days < 1 then
    return false;
  end if;
  if p_window_days is null then
    with ins as (
      insert into public.owner_alert_notices (user_id, dedup_key)
      values (p_user_id, p_dedup_key)
      on conflict (user_id, dedup_key) do nothing
      returning 1
    )
    select exists(select 1 from ins) into claimed;
  else
    with ins as (
      insert into public.owner_alert_notices (user_id, dedup_key)
      values (p_user_id, p_dedup_key)
      on conflict (user_id, dedup_key) do update
        set sent_at = now()
        where public.owner_alert_notices.sent_at
          < now() - make_interval(days => p_window_days)
      returning 1
    )
    select exists(select 1 from ins) into claimed;
  end if;
  return claimed;
end;
$$;

-- release_owner_alert — drop the claim when the email never went out,
-- so the next failure can try again.
create or replace function public.release_owner_alert(
  p_user_id uuid,
  p_dedup_key text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.owner_alert_notices
  where user_id = p_user_id
    and dedup_key = p_dedup_key;
end;
$$;

-- Trust boundary: revoked from public/anon/authenticated, granted to
-- service_role only. Guarded: vanilla Postgres in CI has none of
-- these roles.
do $$
begin
  revoke execute on function public.claim_owner_alert(uuid, text, integer) from public;
  revoke execute on function public.release_owner_alert(uuid, text) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.claim_owner_alert(uuid, text, integer) from anon;
    revoke execute on function public.release_owner_alert(uuid, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.claim_owner_alert(uuid, text, integer) from authenticated;
    revoke execute on function public.release_owner_alert(uuid, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.claim_owner_alert(uuid, text, integer) to service_role;
    grant execute on function public.release_owner_alert(uuid, text) to service_role;
  end if;
end $$;
