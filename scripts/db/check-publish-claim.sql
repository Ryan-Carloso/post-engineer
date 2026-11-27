-- Behaviour check for 094_publish-due-scheduler.sql.
-- Run as a superuser after the migration chain, on a database whose
-- anon/authenticated/service_role roles exist (same fixture as
-- check-core-tables-rls.sql). Rolls the fixture back. Exits non-zero when an
-- assertion fails.

begin;

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

create function pg_temp.slot(p_id uuid, p_user uuid, p_schedule uuid, p_status text, p_slot_at timestamptz, p_not_before timestamptz)
returns void
language sql
as $$
  insert into public.scheduled_posts (id, schedule_id, user_id, slot_at, status, publish_not_before, title, media_kind, media_ref)
  values (p_id, p_schedule, p_user, p_slot_at, p_status, p_not_before, 'title', 'upload', p_id::text);
$$;

insert into public.user_profiles (id, access_until) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() + interval '30 days'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', now() - interval '1 day');

insert into public.personas (id, user_id, name, ai_label)
values ('99999999-9999-9999-9999-999999999999', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Maya', true);

insert into public.schedules (id, user_id, persona_id, providers, youtube_account_ids, instagram_account_ids, linkedin_account_ids, bluesky_account_ids, times)
values
  ('51111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '99999999-9999-9999-9999-999999999999', array['youtube'], array['yt-1'], '{}', '{}', '{}', '{}'),
  ('52222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', null, array['youtube'], array['yt-2'], '{}', '{}', '{}', '{}');

select pg_temp.expect_value($$select public.claim_next_publish_slot(now(), interval '30 minutes')::text$$, null, 'no slot, no claim');

select pg_temp.slot('10000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '51111111-1111-1111-1111-111111111111', 'awaiting_approval', now() - interval '1 hour', null);
select pg_temp.slot('10000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '51111111-1111-1111-1111-111111111111', 'pending', now() - interval '1 hour', null);
select pg_temp.slot('10000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '51111111-1111-1111-1111-111111111111', 'failed', now() - interval '1 hour', null);
select pg_temp.slot('10000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '51111111-1111-1111-1111-111111111111', 'expired', now() - interval '1 hour', null);
select pg_temp.slot('10000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '51111111-1111-1111-1111-111111111111', 'published', now() - interval '1 hour', null);
select pg_temp.expect_value($$select public.claim_next_publish_slot(now(), interval '30 minutes')::text$$, null, 'awaiting_approval, pending, failed, expired and published slots are never claimed');

select pg_temp.slot('10000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '51111111-1111-1111-1111-111111111111', 'ready', now() + interval '1 hour', null);
select pg_temp.expect_value($$select public.claim_next_publish_slot(now(), interval '30 minutes')::text$$, null, 'a ready slot that is not due is not claimed');

select pg_temp.slot('10000000-0000-0000-0000-000000000007', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '52222222-2222-2222-2222-222222222222', 'ready', now() - interval '1 hour', null);
select pg_temp.slot('10000000-0000-0000-0000-000000000008', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '52222222-2222-2222-2222-222222222222', 'publishing', now() - interval '1 hour', null);
select pg_temp.expect_value($$select public.claim_next_publish_slot(now(), interval '30 minutes')::text$$, null, 'an owner without access is never a candidate');

insert into public.scheduled_posts (id, schedule_id, user_id, slot_at, status, title)
values ('10000000-0000-0000-0000-000000000009', '51111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', now() - interval '1 hour', 'ready', 'unknown owner');
select pg_temp.expect_value($$select public.claim_next_publish_slot(now(), interval '30 minutes')::text$$, null, 'an owner with no profile row is never a candidate');

select pg_temp.slot('10000000-0000-0000-0000-000000000010', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '51111111-1111-1111-1111-111111111111', 'publishing', now() - interval '2 hours', now() + interval '10 minutes');
select pg_temp.expect_value($$select public.claim_next_publish_slot(now(), interval '30 minutes')::text$$, null, 'a publishing slot under a live lease is not reclaimed');

select pg_temp.slot('10000000-0000-0000-0000-000000000011', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '51111111-1111-1111-1111-111111111111', 'ready', now() - interval '30 minutes', null);
select pg_temp.expect_value($$select (c->>'id') || ':' || (c->>'resumed') || ':' || (c->>'status') from (select public.claim_next_publish_slot(now(), interval '30 minutes') as c) q$$,
  '10000000-0000-0000-0000-000000000011:false:publishing', 'a due ready slot is claimed, not resumed, and moves to publishing');
select pg_temp.expect_value($$select (publish_not_before > now() + interval '29 minutes' and publish_not_before <= now() + interval '30 minutes')::text from public.scheduled_posts where id = '10000000-0000-0000-0000-000000000011'$$,
  'true', 'the claim parks the lease on publish_not_before');
select pg_temp.expect_value($$select public.claim_next_publish_slot(now(), interval '30 minutes')::text$$, null, 'the slot just claimed is not claimed twice');

select pg_temp.slot('10000000-0000-0000-0000-000000000012', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '51111111-1111-1111-1111-111111111111', 'publishing', now() - interval '3 hours', now() - interval '1 minute');
select pg_temp.expect_value($$select (c->>'id') || ':' || (c->>'resumed') from (select public.claim_next_publish_slot(now(), interval '30 minutes') as c) q$$,
  '10000000-0000-0000-0000-000000000012:true', 'a publishing slot whose lease lapsed is reclaimed as resumed');

select pg_temp.slot('10000000-0000-0000-0000-000000000013', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '51111111-1111-1111-1111-111111111111', 'publishing', now() - interval '4 hours', null);
select pg_temp.expect_value($$select (c->>'id') || ':' || (c->>'resumed') from (select public.claim_next_publish_slot(now(), interval '30 minutes') as c) q$$,
  '10000000-0000-0000-0000-000000000013:true', 'a publishing slot with a null lease is reclaimed as resumed');

update public.scheduled_posts set status = 'ready', publish_not_before = null, slot_at = now() - interval '5 minutes', first_comment = 'hi'
where id = '10000000-0000-0000-0000-000000000011';
select pg_temp.expect_value($$select c->'schedules'->'personas'->>'name' || ':' || (c->'schedules'->'personas'->>'ai_label') || ':' || (c->'schedules'->'youtube_account_ids'->>0) || ':' || (c->>'first_comment') from (select public.claim_next_publish_slot(now(), interval '30 minutes') as c) q$$,
  'Maya:true:yt-1:hi', 'the claim returns the slot with its schedule accounts, persona and first comment');

select pg_temp.expect_value($$select count(*)::text from public.scheduled_posts where status = 'ready' and user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$, '1', 'the inactive owner ready slot is still ready before the expiry call');
select pg_temp.expect_value($$select jsonb_array_length(public.expire_inactive_ready_slots(now()))::text$$, '1', 'one inactive ready slot expires');
select pg_temp.expect_value($$select status || ':' || coalesce(publish_not_before::text, 'null') from public.scheduled_posts where id = '10000000-0000-0000-0000-000000000007'$$, 'expired:null', 'the expired slot clears its lease');
select pg_temp.expect_value($$select status from public.scheduled_posts where id = '10000000-0000-0000-0000-000000000008'$$, 'publishing', 'an inactive publishing slot is left alone');
select pg_temp.expect_value($$select status from public.scheduled_posts where id = '10000000-0000-0000-0000-000000000006'$$, 'ready', 'an active owner ready slot is never expired');
select pg_temp.expect_value($$select jsonb_array_length(public.expire_inactive_ready_slots(now()))::text$$, '0', 'expiring twice is a no-op');

insert into public.scheduler_leases (job, lease_until, holder) values ('claim-check', now() + interval '1 hour', 'holder-a');
select public.release_scheduler_lease('claim-check', 'holder-b');
select pg_temp.expect_value($$select (lease_until > now())::text from public.scheduler_leases where job = 'claim-check'$$, 'true', 'another holder cannot release the lease');
select public.release_scheduler_lease('claim-check', 'holder-a');
select pg_temp.expect_value($$select (lease_until <= now())::text from public.scheduler_leases where job = 'claim-check'$$, 'true', 'the holder releases its lease');
select pg_temp.expect_value($$select public.try_acquire_scheduler_lease('claim-check', 60, 'holder-b')::text$$, 'true', 'a released lease can be acquired at once');

select pg_temp.expect_value($$select has_function_privilege('anon', 'public.claim_next_publish_slot(timestamptz, interval)', 'execute')::text$$, 'false', 'anon cannot claim');
select pg_temp.expect_value($$select has_function_privilege('authenticated', 'public.claim_next_publish_slot(timestamptz, interval)', 'execute')::text$$, 'false', 'authenticated cannot claim');
select pg_temp.expect_value($$select has_function_privilege('service_role', 'public.claim_next_publish_slot(timestamptz, interval)', 'execute')::text$$, 'true', 'service_role can claim');
select pg_temp.expect_value($$select has_function_privilege('authenticated', 'public.expire_inactive_ready_slots(timestamptz, integer)', 'execute')::text$$, 'false', 'authenticated cannot expire');
select pg_temp.expect_value($$select has_function_privilege('authenticated', 'public.release_scheduler_lease(text, text)', 'execute')::text$$, 'false', 'authenticated cannot release a lease');

rollback;
