-- Behaviour check for 091_access-entitlement.sql.
-- Run as a superuser after the migration chain, on a database whose
-- anon/authenticated/service_role roles exist (same fixture as
-- check-core-tables-rls.sql). Rolls the fixture back. Exits non-zero when an
-- assertion fails.

begin;

create function pg_temp.expect_state(p_sql text, p_state text, p_label text)
returns void
language plpgsql
as $$
declare
  v_state text;
begin
  begin
    execute p_sql;
    v_state := 'ok';
  exception
    when others then
      v_state := sqlstate;
  end;
  if v_state is distinct from p_state then
    raise exception '% expected sqlstate % but got %', p_label, p_state, v_state;
  end if;
end;
$$;

create function pg_temp.expect_value(p_sql text, p_value text, p_label text)
returns void
language plpgsql
as $$
declare
  v_value text;
begin
  execute p_sql into v_value;
  if v_value is distinct from p_value then
    raise exception '% expected % but got %', p_label, p_value, v_value;
  end if;
end;
$$;

insert into public.user_profiles (id, access_until)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() + interval '30 days');

insert into public.user_billing_links (user_id, stripe_customer_id)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cus_access_check');

select pg_temp.expect_value(
  $$select (access_until > now() + interval '6 days')::text from public.user_profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'true', 'an admitted account keeps publishing far ahead');

insert into public.user_profiles (id)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd');
select pg_temp.expect_value(
  $$select (access_until <= now() and subscription_status is null)::text from public.user_profiles where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'$$,
  'true', 'a new account is awaiting the beta and cannot publish');

update public.user_profiles
set access_until = '2099-01-01T00:00:00Z', subscription_status = 'beta'
where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
select pg_temp.expect_value(
  $$select (access_until > now() + interval '365 days')::text from public.user_profiles where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'$$,
  'true', 'the beta status is accepted and admits the account');

select pg_temp.expect_value(
  $$select public.link_stripe_customer('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cus_access_check')::text$$,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'linking the same customer twice is idempotent');

select pg_temp.expect_value(
  $$select public.apply_subscription_access('cus_access_check', 'sub_1', 'active', now() + interval '20 days')::text$$,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'an active subscription is applied');
select pg_temp.expect_value(
  $$select subscription_status from public.user_profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'active', 'the active status is recorded');
select pg_temp.expect_value(
  $$select (access_until between now() + interval '19 days' and now() + interval '20 days')::text from public.user_profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'true', 'the paid-through date becomes the access window');
select pg_temp.expect_value(
  $$select stripe_subscription_id from public.user_billing_links where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'sub_1', 'the subscription id is stored on the link');

select pg_temp.expect_value(
  $$select public.apply_subscription_access('cus_access_check', 'sub_1', 'past_due', now() + interval '1 day')::text$$,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a past_due subscription keeps a grace window');
select pg_temp.expect_value(
  $$select (access_until >= now() + interval '3 days')::text from public.user_profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'true', 'past_due grants at least the 3-day dunning grace');

select pg_temp.expect_value(
  $$select public.apply_subscription_access('cus_access_check', 'sub_1', 'canceled', null)::text$$,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a cancellation is applied');
select pg_temp.expect_value(
  $$select (access_until <= now() + interval '1 second')::text from public.user_profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'true', 'a cancellation cuts access immediately');
select pg_temp.expect_value(
  $$select subscription_status from public.user_profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'canceled', 'the canceled status is recorded');

select pg_temp.expect_value(
  $$select public.apply_subscription_access('cus_access_check', 'sub_1', 'active', now() - interval '5 days')::text$$,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a stale paid-through date still applies');
select pg_temp.expect_value(
  $$select (access_until <= now() + interval '1 second')::text from public.user_profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'true', 'a paid-through date in the past never extends access');

select pg_temp.expect_state(
  $$select public.apply_subscription_access('cus_access_check', 'sub_1', 'refunded', null)$$,
  '22023', 'an unknown subscription status raises instead of guessing');

select pg_temp.expect_state(
  $$select public.apply_subscription_access('cus_missing', 'sub_9', 'active', now() + interval '1 day')$$,
  '23503', 'an unknown customer raises instead of guessing');

select pg_temp.expect_value(
  $$select public.revoke_access('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')::text$$,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'an operator revoke is applied');
select pg_temp.expect_value(
  $$select (access_until <= now() + interval '1 second')::text from public.user_profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'true', 'a revoke cuts access immediately');
select pg_temp.expect_value(
  $$select subscription_status from public.user_profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'canceled', 'a revoke records the account as no longer on a subscription');

select pg_temp.expect_state(
  $$select public.revoke_access('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  '23503', 'revoking an unknown user raises');

set local role authenticated;
select pg_temp.expect_state(
  $$select public.apply_subscription_access('cus_access_check', 'sub_1', 'active', now())$$,
  '42501', 'authenticated cannot apply subscription access');
select pg_temp.expect_state(
  $$select public.revoke_access('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  '42501', 'authenticated cannot revoke access');
select pg_temp.expect_state(
  $$select public.link_stripe_customer('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cus_hijack')$$,
  '42501', 'authenticated cannot relink a Stripe customer');
reset role;

set local role anon;
select pg_temp.expect_state(
  $$select public.revoke_access('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  '42501', 'anon cannot revoke access');
reset role;

select pg_temp.expect_value(
  $$select count(*)::text from public.user_billing_links where stripe_customer_id = 'cus_hijack'$$,
  '0', 'no unprivileged relink survived the check');

rollback;
