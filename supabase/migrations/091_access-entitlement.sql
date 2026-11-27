-- 091 — publish entitlement, independent of how the account got there.
--
-- Before: publishing was gated only by user_profiles.trial_ends_at, so a
-- paying customer who cancelled kept publishing forever, and a refunded or
-- suspended account looked exactly like an active one.
--
-- After: user_profiles.access_until is the single instant publishing stops.
-- Every path writes that one column:
--   * a new account starts on the 7-day trial (access_until = trial_ends_at);
--   * a subscription renewal moves it to the paid-through date;
--   * a cancellation, a refund or an exhausted dunning window moves it to
--     now(), so the next publish tick pauses the account;
--   * an operator can move it by hand while billing stays manual.
-- The engine and the web read access_until only; they know nothing about
-- Stripe. apply_subscription_access() is the one place Stripe state becomes
-- access, and it is callable by the service role alone.
--
-- The Stripe identifiers live in user_billing_links, never on user_profiles:
-- that table has a table-level SELECT grant to authenticated, so a customer
-- id on it would be readable by the owner's browser for no reason.

alter table public.user_profiles
  add column if not exists access_until timestamptz,
  add column if not exists subscription_status text;

update public.user_profiles
set access_until = trial_ends_at
where access_until is null;

alter table public.user_profiles
  alter column access_until set default (now() + interval '7 days');

alter table public.user_profiles
  alter column access_until set not null;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'user_profiles_subscription_status_check') then
    alter table public.user_profiles drop constraint user_profiles_subscription_status_check;
  end if;
  alter table public.user_profiles
    add constraint user_profiles_subscription_status_check
    check (
      subscription_status is null
      or subscription_status in (
        'trialing', 'active', 'past_due', 'canceled',
        'unpaid', 'incomplete', 'incomplete_expired', 'paused'
      )
    );
end $$;

create table if not exists public.user_billing_links (
  user_id uuid not null primary key references public.user_profiles(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text,
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_billing_links_user_id_fkey'
      and conrelid = 'public.user_billing_links'::regclass
  ) then
    alter table public.user_billing_links
      add constraint user_billing_links_user_id_fkey
      foreign key (user_id) references public.user_profiles(id) on delete cascade;
  end if;
end $$;

create unique index if not exists user_billing_links_stripe_customer_id_key
  on public.user_billing_links (stripe_customer_id);

alter table public.user_billing_links enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.user_billing_links from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.user_billing_links from authenticated;
  end if;
end $$;

create or replace function public.apply_subscription_access(
  p_customer_id text,
  p_subscription_id text,
  p_status text,
  p_current_period_end timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_until timestamptz;
  v_dunning_grace constant interval := interval '3 days';
begin
  if p_status is null or p_status not in (
    'trialing', 'active', 'past_due', 'canceled',
    'unpaid', 'incomplete', 'incomplete_expired', 'paused'
  ) then
    raise exception 'apply_subscription_access: unknown subscription status %', p_status
      using errcode = '22023';
  end if;

  select user_id into v_user_id
  from public.user_billing_links
  where stripe_customer_id = p_customer_id
  for update;

  if v_user_id is null then
    raise exception 'apply_subscription_access: no profile for customer %', p_customer_id
      using errcode = '23503';
  end if;

  if p_status in ('active', 'trialing') then
    v_until := greatest(coalesce(p_current_period_end, now()), now());
  elsif p_status = 'past_due' then
    v_until := greatest(coalesce(p_current_period_end, now()) + v_dunning_grace, now());
  else
    v_until := now();
  end if;

  update public.user_profiles
  set access_until = v_until,
      subscription_status = p_status
  where id = v_user_id;

  update public.user_billing_links
  set stripe_subscription_id = coalesce(p_subscription_id, stripe_subscription_id),
      updated_at = now()
  where user_id = v_user_id;

  return v_user_id;
end $$;

create or replace function public.link_stripe_customer(
  p_user_id uuid,
  p_customer_id text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  insert into public.user_billing_links (user_id, stripe_customer_id)
  values (p_user_id, p_customer_id)
  on conflict (user_id) do update
    set stripe_customer_id = excluded.stripe_customer_id,
        updated_at = now()
  returning user_id into v_user_id;

  return v_user_id;
end $$;

create or replace function public.revoke_access(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  update public.user_profiles
  set access_until = now(),
      subscription_status = 'canceled'
  where id = p_user_id
  returning id into v_user_id;

  if v_user_id is null then
    raise exception 'revoke_access: no profile for user %', p_user_id
      using errcode = '23503';
  end if;

  return v_user_id;
end $$;

do $$
begin
  revoke execute on function public.apply_subscription_access(text, text, text, timestamptz) from public;
  revoke execute on function public.link_stripe_customer(uuid, text) from public;
  revoke execute on function public.revoke_access(uuid) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.apply_subscription_access(text, text, text, timestamptz) from anon;
    revoke execute on function public.link_stripe_customer(uuid, text) from anon;
    revoke execute on function public.revoke_access(uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.apply_subscription_access(text, text, text, timestamptz) from authenticated;
    revoke execute on function public.link_stripe_customer(uuid, text) from authenticated;
    revoke execute on function public.revoke_access(uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.apply_subscription_access(text, text, text, timestamptz) to service_role;
    grant execute on function public.link_stripe_customer(uuid, text) to service_role;
    grant execute on function public.revoke_access(uuid) to service_role;
  end if;
end $$;
