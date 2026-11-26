-- Privilege check for 066_core-tables-rls.sql.
-- Run as a superuser after the migration chain, on a database whose
-- anon/authenticated/service_role roles exist and whose auth.uid() reads
-- current_setting('request.jwt.claim.sub', true). Supabase-like default
-- GRANT ALL must already have been in force when the tables were created,
-- so a forgotten revoke is visible.
--
-- Rolls the fixture back. Exits non-zero when an assertion fails.

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

create function pg_temp.expect_count(p_sql text, p_count integer, p_label text)
returns void
language plpgsql
as $$
declare
  v_count integer;
begin
  execute p_sql into v_count;
  if v_count is distinct from p_count then
    raise exception '% expected % rows but got %', p_label, p_count, v_count;
  end if;
end;
$$;

insert into public.user_profiles (id, trial_ends_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2099-01-01T00:00:00Z'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2099-01-02T00:00:00Z');

insert into public.personas (id, user_id, name)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ada'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Bea');

insert into public.schedules (
  id, user_id, providers, youtube_account_ids, instagram_account_ids,
  times, linkedin_account_ids, bluesky_account_ids
)
values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '{}', '{}', '{}', '{}', '{}', '{}'
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb02',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '{}', '{}', '{}', '{}', '{}', '{}'
  );

insert into public.scheduled_posts (id, schedule_id, user_id, slot_at, title)
values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '2026-12-01T00:00:00Z',
    'mine'
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb03',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb02',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '2026-12-01T00:00:00Z',
    'theirs'
  );

insert into public.social_accounts (
  id, user_id, provider, provider_account_id, account_metadata, encrypted_tokens
)
values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'youtube',
    'yt-a',
    '{}',
    'cipher-a'
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb04',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'youtube',
    'yt-b',
    '{}',
    'cipher-b'
  );

-- No policy may be FOR ALL, and every core-table policy is TO authenticated.
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'user_profiles', 'personas', 'schedules', 'scheduled_posts',
      'social_accounts'
    )
    and (
      p.polcmd = '*'
      or p.polroles <> array[(select oid from pg_roles where rolname = 'authenticated')]
    );
  if v_count <> 0 then
    raise exception 'core tables still have a for-all or non-authenticated policy (% rows)', v_count;
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

-- Cross-user reads return no rows.
select pg_temp.expect_count(
  $$select count(*) from public.user_profiles where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  0, 'user B profile hidden');
select pg_temp.expect_count(
  $$select count(*) from public.personas where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  0, 'user B personas hidden');
select pg_temp.expect_count(
  $$select count(*) from public.schedules where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  0, 'user B schedules hidden');
select pg_temp.expect_count(
  $$select count(*) from public.scheduled_posts where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  0, 'user B slots hidden');
select pg_temp.expect_count(
  $$select count(*) from public.social_accounts where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  0, 'user B accounts hidden');

-- Own reads the session client performs.
select pg_temp.expect_count(
  $$select count(*) from public.user_profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  1, 'own profile readable');
select pg_temp.expect_count(
  $$select count(*) from public.user_profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and trial_ends_at = '2099-01-01T00:00:00Z'$$,
  1, 'own trial end readable');
select pg_temp.expect_count(
  $$select count(*) from public.personas where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'$$,
  1, 'own persona readable');
select pg_temp.expect_count(
  $$select count(*) from public.schedules where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02'$$,
  1, 'own schedule readable');
select pg_temp.expect_count(
  $$select count(*) from public.scheduled_posts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03' and status = 'pending'$$,
  1, 'own slot readable');
select pg_temp.expect_count(
  $$select count(*) from public.social_accounts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04' and account_name is null$$,
  1, 'own account public columns readable');
select pg_temp.expect_count(
  $$select count(*) from public.social_accounts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04' and needs_reconnect = false$$,
  1, 'own account needs_reconnect readable');

-- The trial end is not writable with the user JWT.
select pg_temp.expect_state(
  $$update public.user_profiles set trial_ends_at = '2100-01-01T00:00:00Z' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  '42501', 'trial_ends_at update denied');
select pg_temp.expect_state(
  $$insert into public.user_profiles (id) values ('cccccccc-cccc-cccc-cccc-cccccccccccc')$$,
  '42501', 'user_profiles insert denied');
select pg_temp.expect_state(
  $$delete from public.user_profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  '42501', 'user_profiles delete denied');

select pg_temp.expect_state(
  $$update public.scheduled_posts set status = 'published' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03'$$,
  '42501', 'scheduled_posts status update denied');
select pg_temp.expect_state(
  $$insert into public.scheduled_posts (schedule_id, user_id, slot_at) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now())$$,
  '42501', 'scheduled_posts insert denied');

select pg_temp.expect_state(
  $$insert into public.schedules (user_id, providers, youtube_account_ids, instagram_account_ids, times, linkedin_account_ids, bluesky_account_ids) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{}', '{}', '{}', '{}', '{}', '{}')$$,
  '42501', 'schedules insert denied');
select pg_temp.expect_state(
  $$update public.schedules set active = false where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02'$$,
  '42501', 'schedules update denied');

select pg_temp.expect_state(
  $$select encrypted_tokens from public.social_accounts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04'$$,
  '42501', 'encrypted_tokens select denied');

-- Deletes and writes a cookie JWT must not be able to perform. A session
-- delete of scheduled_posts drops a post the user scheduled. A direct slot_at
-- write publishes a ready slot as soon as it is due, skipping the route's
-- window. A direct encrypted_tokens write stores ciphertext the refresh
-- path cannot decrypt. Persona columns (photo_path, identity_card) are
-- coerced in the route, so PostgREST must not write them either. The routes do these on the
-- service client after their own checks.
select pg_temp.expect_state(
  $$delete from public.scheduled_posts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03'$$,
  '42501', 'slot delete denied');
select pg_temp.expect_state(
  $$delete from public.schedules where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02'$$,
  '42501', 'schedule delete denied');
select pg_temp.expect_state(
  $$update public.social_accounts set encrypted_tokens = 'x' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04'$$,
  '42501', 'encrypted_tokens update denied');
select pg_temp.expect_state(
  $$update public.scheduled_posts set title = 'renamed' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03'$$,
  '42501', 'slot title update denied');
select pg_temp.expect_state(
  $$update public.scheduled_posts set slot_at = '2026-12-02T00:00:00Z' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03'$$,
  '42501', 'slot time update denied');
select pg_temp.expect_count(
  $$select count(*) from public.scheduled_posts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03' and title = 'mine'$$,
  1, 'title unchanged');

select pg_temp.expect_state(
  $$insert into public.personas (user_id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Cara')$$,
  '42501', 'persona insert denied');
select pg_temp.expect_state(
  $$update public.personas set name = 'Ada 2' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'$$,
  '42501', 'persona update denied');
select pg_temp.expect_state(
  $$update public.personas set photo_path = 'evil.png' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'$$,
  '42501', 'persona photo_path update denied');
select pg_temp.expect_state(
  $$delete from public.personas where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'$$,
  '42501', 'persona delete denied');

select pg_temp.expect_state(
  $$insert into public.social_accounts (user_id, provider, provider_account_id, account_metadata, encrypted_tokens) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bluesky', 'bsky-a', '{}', 'cipher-new')$$,
  '42501', 'social account insert denied');
select pg_temp.expect_state(
  $$update public.social_accounts set account_name = 'Ada YT', updated_at = now() where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04'$$,
  '42501', 'social account metadata update denied');
select pg_temp.expect_state(
  $$update public.social_accounts set needs_reconnect = true where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04'$$,
  '42501', 'needs_reconnect update denied');
select pg_temp.expect_state(
  $$delete from public.social_accounts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04'$$,
  '42501', 'social account delete denied');
select pg_temp.expect_state(
  $$select encrypted_tokens from public.social_accounts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04'$$,
  '42501', 'encrypted_tokens still unreadable');

-- anon has no table privilege.
reset role;
set local role anon;
select pg_temp.expect_state(
  $$select * from public.user_profiles$$, '42501', 'anon profile read denied');
select pg_temp.expect_state(
  $$select id from public.scheduled_posts$$, '42501', 'anon slot read denied');
select pg_temp.expect_state(
  $$select id from public.social_accounts$$, '42501', 'anon account read denied');

-- service_role still writes the trial end (it bypasses RLS and keeps its grants).
reset role;
set local role service_role;
select pg_temp.expect_state(
  $$update public.user_profiles set trial_ends_at = '2099-06-01T00:00:00Z' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'ok', 'service_role can write trial_ends_at');
select pg_temp.expect_count(
  $$select count(*) from public.social_accounts where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb04' and encrypted_tokens = 'cipher-b'$$,
  1, 'service_role can read encrypted_tokens');
select pg_temp.expect_state(
  $$update public.social_accounts set encrypted_tokens = 'cipher-rotated' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04'$$,
  'ok', 'service_role can write encrypted_tokens');
select pg_temp.expect_state(
  $$update public.scheduled_posts set title = 'renamed', slot_at = '2026-12-02T00:00:00Z' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03'$$,
  'ok', 'service_role can update a slot');
select pg_temp.expect_state(
  $$delete from public.scheduled_posts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03'$$,
  'ok', 'service_role can delete a slot');
select pg_temp.expect_state(
  $$delete from public.schedules where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02'$$,
  'ok', 'service_role can delete a schedule');

rollback;
