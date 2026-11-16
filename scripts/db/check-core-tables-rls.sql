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

insert into public.user_profiles (id, tokens_balance, free_tokens_balance)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 5, 1),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 7, 2);

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

insert into public.scheduled_posts (id, schedule_id, user_id, slot_at, charged_tokens, title)
values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '2026-12-01T00:00:00Z',
    10,
    'mine'
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb03',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb02',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '2026-12-01T00:00:00Z',
    10,
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

insert into public.video_generations (id, user_id, generation_id, status, tokens_refunded)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa05', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'gen-a', 'pending', false),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb05', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'gen-b', 'pending', false);

insert into public.token_transactions (id, user_id, amount, type)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa06', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 5, 'grant'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb06', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 7, 'grant');

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
      'social_accounts', 'video_generations', 'token_transactions'
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
select pg_temp.expect_count(
  $$select count(*) from public.video_generations where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  0, 'user B generations hidden');
select pg_temp.expect_count(
  $$select count(*) from public.token_transactions where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  0, 'user B ledger hidden');

-- Own reads the session client performs.
select pg_temp.expect_count(
  $$select count(*) from public.user_profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  1, 'own profile readable');
select pg_temp.expect_count(
  $$select count(*) from public.user_profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and tokens_balance = 5 and free_tokens_balance = 1$$,
  1, 'own balances readable');
select pg_temp.expect_count(
  $$select count(*) from public.token_transactions where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  1, 'own ledger readable');
select pg_temp.expect_count(
  $$select count(*) from public.personas where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'$$,
  1, 'own persona readable');
select pg_temp.expect_count(
  $$select count(*) from public.schedules where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02'$$,
  1, 'own schedule readable');
select pg_temp.expect_count(
  $$select count(*) from public.scheduled_posts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03' and charged_tokens = 10$$,
  1, 'own slot billing columns readable');
select pg_temp.expect_count(
  $$select count(*) from public.video_generations where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa05' and tokens_refunded = false$$,
  1, 'own generation readable');
select pg_temp.expect_count(
  $$select count(*) from public.social_accounts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04' and account_name is null$$,
  1, 'own account public columns readable');

-- Billing and server columns are not writable with the user JWT.
select pg_temp.expect_state(
  $$update public.user_profiles set tokens_balance = 99999 where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  '42501', 'tokens_balance update denied');
select pg_temp.expect_state(
  $$update public.user_profiles set free_tokens_balance = 99999 where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  '42501', 'free_tokens_balance update denied');
select pg_temp.expect_state(
  $$update public.user_profiles set stripe_customer_id = 'cus_evil' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  '42501', 'stripe_customer_id update denied');
select pg_temp.expect_state(
  $$insert into public.user_profiles (id) values ('cccccccc-cccc-cccc-cccc-cccccccccccc')$$,
  '42501', 'user_profiles insert denied');
select pg_temp.expect_state(
  $$delete from public.user_profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  '42501', 'user_profiles delete denied');

select pg_temp.expect_state(
  $$update public.scheduled_posts set charged_tokens = 0 where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03'$$,
  '42501', 'charged_tokens update denied');
select pg_temp.expect_state(
  $$update public.scheduled_posts set discount_tokens = 10 where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03'$$,
  '42501', 'discount_tokens update denied');
select pg_temp.expect_state(
  $$update public.scheduled_posts set status = 'published' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03'$$,
  '42501', 'scheduled_posts status update denied');
select pg_temp.expect_state(
  $$update public.scheduled_posts set task_id = 'task-evil' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03'$$,
  '42501', 'task_id update denied');
select pg_temp.expect_state(
  $$update public.scheduled_posts set batch_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03'$$,
  '42501', 'batch_id update denied');
select pg_temp.expect_state(
  $$insert into public.scheduled_posts (schedule_id, user_id, slot_at, charged_tokens) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now(), 0)$$,
  '42501', 'scheduled_posts insert denied');

select pg_temp.expect_state(
  $$update public.video_generations set status = 'completed' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa05'$$,
  '42501', 'video status update denied');
select pg_temp.expect_state(
  $$update public.video_generations set tokens_refunded = true where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa05'$$,
  '42501', 'tokens_refunded update denied');
select pg_temp.expect_state(
  $$insert into public.video_generations (user_id, generation_id) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'gen-evil')$$,
  '42501', 'video_generations insert denied');

select pg_temp.expect_state(
  $$insert into public.schedules (user_id, providers, youtube_account_ids, instagram_account_ids, times, linkedin_account_ids, bluesky_account_ids) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{}', '{}', '{}', '{}', '{}', '{}')$$,
  '42501', 'schedules insert denied');
select pg_temp.expect_state(
  $$update public.schedules set active = false where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02'$$,
  '42501', 'schedules update denied');

select pg_temp.expect_state(
  $$insert into public.token_transactions (user_id, amount, type) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 99999, 'grant')$$,
  '42501', 'token_transactions insert denied');
select pg_temp.expect_state(
  $$update public.token_transactions set amount = 99999 where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa06'$$,
  '42501', 'token_transactions update denied');
select pg_temp.expect_state(
  $$delete from public.token_transactions where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa06'$$,
  '42501', 'token_transactions delete denied');

select pg_temp.expect_state(
  $$select encrypted_tokens from public.social_accounts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04'$$,
  '42501', 'encrypted_tokens select denied');

-- Session writes that the cookie routes really perform.
select pg_temp.expect_state(
  $$update public.scheduled_posts set title = 'renamed' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03'$$,
  'ok', 'slot title update');
select pg_temp.expect_state(
  $$update public.scheduled_posts set slot_at = '2026-12-02T00:00:00Z' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03'$$,
  'ok', 'slot time update');
select pg_temp.expect_count(
  $$select count(*) from public.scheduled_posts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03' and title = 'renamed' and charged_tokens = 10$$,
  1, 'title changed and charge unchanged');

select pg_temp.expect_state(
  $$insert into public.personas (user_id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Cara')$$,
  'ok', 'persona insert');
select pg_temp.expect_state(
  $$update public.personas set name = 'Ada 2' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'$$,
  'ok', 'persona update');
select pg_temp.expect_state(
  $$insert into public.personas (user_id, name) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'stolen')$$,
  '42501', 'persona insert for another user denied');

select pg_temp.expect_state(
  $$insert into public.social_accounts (user_id, provider, provider_account_id, account_metadata, encrypted_tokens) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bluesky', 'bsky-a', '{}', 'cipher-new')$$,
  'ok', 'social account insert');
select pg_temp.expect_state(
  $$update public.social_accounts set account_name = 'Ada YT', updated_at = now() where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04'$$,
  'ok', 'social account metadata update');
select pg_temp.expect_state(
  $$update public.social_accounts set encrypted_tokens = 'cipher-rotated', updated_at = now() where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04'$$,
  'ok', 'social account token write');
select pg_temp.expect_state(
  $$select encrypted_tokens from public.social_accounts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04'$$,
  '42501', 'encrypted_tokens still unreadable after write');

-- Deletes the session client performs (persona cascade, schedule cancel, disconnect).
select pg_temp.expect_state(
  $$delete from public.scheduled_posts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03'$$,
  'ok', 'slot delete');
select pg_temp.expect_state(
  $$delete from public.schedules where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02'$$,
  'ok', 'schedule delete');
select pg_temp.expect_state(
  $$delete from public.video_generations where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa05'$$,
  'ok', 'generation delete');
select pg_temp.expect_state(
  $$delete from public.personas where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'$$,
  'ok', 'persona delete');
select pg_temp.expect_state(
  $$delete from public.social_accounts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04'$$,
  'ok', 'social account delete');

-- anon has no table privilege.
reset role;
set local role anon;
select pg_temp.expect_state(
  $$select * from public.user_profiles$$, '42501', 'anon profile read denied');
select pg_temp.expect_state(
  $$select id from public.scheduled_posts$$, '42501', 'anon slot read denied');
select pg_temp.expect_state(
  $$select id from public.social_accounts$$, '42501', 'anon account read denied');

-- service_role still writes billing (it bypasses RLS and keeps its grants).
reset role;
set local role service_role;
select pg_temp.expect_state(
  $$update public.user_profiles set tokens_balance = 6 where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'ok', 'service_role can write tokens_balance');
select pg_temp.expect_count(
  $$select count(*) from public.social_accounts where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb04' and encrypted_tokens = 'cipher-b'$$,
  1, 'service_role can read encrypted_tokens');

rollback;
