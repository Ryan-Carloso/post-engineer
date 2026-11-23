-- Behaviour check for 080_share-links.sql.
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

select pg_temp.expect_value(
  $$select count(*)::text from public.create_share_link('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'hash-1', null, null, 2)$$,
  '1', 'a link is created while the user is under the cap');
select pg_temp.expect_value(
  $$select count(*)::text from public.create_share_link('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'hash-2', null, now() + interval '1 day', 2)$$,
  '1', 'a second link fits the cap');
select pg_temp.expect_value(
  $$select count(*)::text from public.create_share_link('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'hash-3', null, null, 2)$$,
  '0', 'no link is created once the cap is reached');
select pg_temp.expect_value(
  $$select count(*)::text from public.create_share_link('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'hash-4', null, null, 2)$$,
  '1', 'the cap is per user');

update public.share_links set revoked_at = now() where token_hash = 'hash-1';
select pg_temp.expect_value(
  $$select count(*)::text from public.create_share_link('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'hash-5', null, null, 2)$$,
  '1', 'a revoked link frees a slot of the cap');

update public.share_links set expires_at = now() - interval '1 minute' where token_hash = 'hash-2';
select pg_temp.expect_value(
  $$select count(*)::text from public.create_share_link('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'hash-6', null, null, 2)$$,
  '1', 'an expired link frees a slot of the cap');

select pg_temp.expect_state(
  $$select public.create_share_link('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'hash-5', null, null, 9)$$,
  '23505', 'a token hash is unique');

insert into public.schedules (id, user_id, persona_id, providers, youtube_account_ids, instagram_account_ids, times, linkedin_account_ids, bluesky_account_ids)
values
  ('dddddddd-dddd-dddd-dddd-dddddddddd01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1', array['youtube'], array[]::text[], array[]::text[], array[]::text[], array[]::text[], array[]::text[]),
  ('dddddddd-dddd-dddd-dddd-dddddddddd02', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2', array['instagram', 'bluesky'], array[]::text[], array[]::text[], array[]::text[], array[]::text[], array[]::text[]),
  ('dddddddd-dddd-dddd-dddd-dddddddddd03', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1', array['youtube'], array[]::text[], array[]::text[], array[]::text[], array[]::text[], array[]::text[]);

insert into public.scheduled_posts (id, schedule_id, user_id, slot_at, status, title, charged_tokens)
values
  ('ffffffff-ffff-ffff-ffff-fffffffffff1', 'dddddddd-dddd-dddd-dddd-dddddddddd01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-03-10T10:00:00Z', 'published', 'persona one post', 0),
  ('ffffffff-ffff-ffff-ffff-fffffffffff2', 'dddddddd-dddd-dddd-dddd-dddddddddd02', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-03-11T10:00:00Z', 'pending', 'persona two post', 0),
  ('ffffffff-ffff-ffff-ffff-fffffffffff3', 'dddddddd-dddd-dddd-dddd-dddddddddd09', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-03-12T10:00:00Z', 'published', 'orphan post', 0),
  ('ffffffff-ffff-ffff-ffff-fffffffffff4', 'dddddddd-dddd-dddd-dddd-dddddddddd03', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-03-10T11:00:00Z', 'published', 'other user post', 0),
  ('ffffffff-ffff-ffff-ffff-fffffffffff5', 'dddddddd-dddd-dddd-dddd-dddddddddd01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-03-13T10:00:00Z', 'cancelled', 'cancelled post', 0),
  ('ffffffff-ffff-ffff-ffff-fffffffffff6', 'dddddddd-dddd-dddd-dddd-dddddddddd01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-04-10T10:00:00Z', 'published', 'outside the week', 0),
  ('ffffffff-ffff-ffff-ffff-fffffffffff7', 'dddddddd-dddd-dddd-dddd-dddddddddd03', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-03-14T10:00:00Z', 'published', 'foreign schedule post', 0);

select pg_temp.expect_value(
  $$select string_agg(title, ',' order by slot_at) from public.share_week_posts('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, '2026-03-09T00:00:00Z', '2026-03-16T00:00:00Z', 50)$$,
  'persona one post,persona two post,orphan post,foreign schedule post',
  'an unscoped link reads every post of the owner in the week, not another user''s, cancelled or out-of-week ones');
select pg_temp.expect_value(
  $$select string_agg(title, ',' order by slot_at) from public.share_week_posts('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', array['eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1']::uuid[], '2026-03-09T00:00:00Z', '2026-03-16T00:00:00Z', 50)$$,
  'persona one post',
  'a scoped link reads only the posts of its personas: no orphan, no other persona, no foreign schedule');
select pg_temp.expect_value(
  $$select array_to_string(providers, '+') from public.share_week_posts('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, '2026-03-11T00:00:00Z', '2026-03-12T00:00:00Z', 50)$$,
  'instagram+bluesky', 'the networks come from the schedule');
select pg_temp.expect_value(
  $$select count(*)::text from public.share_week_posts('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, '2026-03-09T00:00:00Z', '2026-03-16T00:00:00Z', 2)$$,
  '2', 'the limit caps the rows');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select pg_temp.expect_state(
  $$select token_hash from public.share_links$$,
  '42501', 'authenticated cannot read token_hash');
select pg_temp.expect_value(
  $$select count(*)::text from (select id, persona_ids, created_at, expires_at, revoked_at, last_viewed_at from public.share_links) s$$,
  '4', 'authenticated reads only its own links');
select pg_temp.expect_state(
  $$update public.share_links set revoked_at = now()$$,
  'ok', 'authenticated can revoke its own links');
select pg_temp.expect_state(
  $$update public.share_links set persona_ids = null$$,
  '42501', 'authenticated cannot change the scope of a link');
select pg_temp.expect_state(
  $$update public.share_links set token_hash = 'x'$$,
  '42501', 'authenticated cannot change the token hash');
select pg_temp.expect_state(
  $$insert into public.share_links (user_id, token_hash) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'direct')$$,
  '42501', 'authenticated cannot insert a link');
select pg_temp.expect_state(
  $$select * from public.create_share_link('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'h', null, null, 9)$$,
  '42501', 'authenticated cannot call create_share_link');
select pg_temp.expect_state(
  $$select * from public.share_week_posts('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, now(), now(), 1)$$,
  '42501', 'authenticated cannot call share_week_posts');

reset role;
set local role anon;
select pg_temp.expect_state(
  $$select id from public.share_links$$,
  '42501', 'anon cannot read share_links');
select pg_temp.expect_state(
  $$select * from public.share_week_posts('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, now(), now(), 1)$$,
  '42501', 'anon cannot call share_week_posts');

reset role;
set local role service_role;
select pg_temp.expect_state(
  $$select token_hash from public.share_links$$,
  'ok', 'service_role can read share_links');
select pg_temp.expect_state(
  $$select * from public.share_week_posts('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, now(), now(), 1)$$,
  'ok', 'service_role can call share_week_posts');

rollback;
