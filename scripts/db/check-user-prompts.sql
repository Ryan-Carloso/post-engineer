-- Behaviour check for 076_user-prompts.sql.
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

insert into public.user_prompts (id, owner_id, slug, title, description, body)
values (
  'cccccccc-cccc-cccc-cccc-cccccccccc01',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'my-prompt', 'Title', 'About', 'First body'
);

select pg_temp.expect_value(
  $$select status from public.user_prompts where id = 'cccccccc-cccc-cccc-cccc-cccccccccc01'$$,
  'private', 'a new prompt starts private');
select pg_temp.expect_value(
  $$select length(content_hash)::text from public.user_prompts where id = 'cccccccc-cccc-cccc-cccc-cccccccccc01'$$,
  '64', 'the trigger fills a sha256 content hash on insert');

create temp table first_hash as
  select content_hash from public.user_prompts where id = 'cccccccc-cccc-cccc-cccc-cccccccccc01';

update public.user_prompts set body = 'Second body' where id = 'cccccccc-cccc-cccc-cccc-cccccccccc01';
select pg_temp.expect_value(
  $$select (content_hash <> (select content_hash from first_hash))::text from public.user_prompts where id = 'cccccccc-cccc-cccc-cccc-cccccccccc01'$$,
  'true', 'editing the body changes the content hash');

insert into public.user_prompts (id, owner_id, slug, title, description, body) values
  ('cccccccc-cccc-cccc-cccc-cccccccccc11', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'shift-a', 'AB', 'C', 'same'),
  ('cccccccc-cccc-cccc-cccc-cccccccccc12', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'shift-b', 'A', 'BC', 'same');
select pg_temp.expect_value(
  $$select (count(distinct content_hash))::text from public.user_prompts where id in ('cccccccc-cccc-cccc-cccc-cccccccccc11', 'cccccccc-cccc-cccc-cccc-cccccccccc12')$$,
  '2', 'moving a character between title and description changes the content hash');

select pg_temp.expect_state(
  $$update public.user_prompts set status = 'approved' where id = 'cccccccc-cccc-cccc-cccc-cccccccccc01'$$,
  '23514', 'approved without an approved hash is rejected');
select pg_temp.expect_state(
  $$update public.user_prompts set status = 'approved', approved_hash = content_hash where id = 'cccccccc-cccc-cccc-cccc-cccccccccc01'$$,
  '23514', 'approved without a reviewer is rejected');
select pg_temp.expect_state(
  $$update public.user_prompts set status = 'rejected', reviewed_by = 'dddddddd-dddd-dddd-dddd-dddddddddddd', reviewed_at = now() where id = 'cccccccc-cccc-cccc-cccc-cccccccccc01'$$,
  '23514', 'rejected without a reason is rejected');
select pg_temp.expect_state(
  $$update public.user_prompts set approved_hash = content_hash where id = 'cccccccc-cccc-cccc-cccc-cccccccccc01'$$,
  '23514', 'an approved hash on a non-approved prompt is rejected');
select pg_temp.expect_state(
  $$update public.user_prompts set status = 'banana' where id = 'cccccccc-cccc-cccc-cccc-cccccccccc01'$$,
  '23514', 'an unknown status is rejected');

update public.user_prompts
set status = 'approved', approved_hash = content_hash,
    reviewed_by = 'dddddddd-dddd-dddd-dddd-dddddddddddd', reviewed_at = now()
where id = 'cccccccc-cccc-cccc-cccc-cccccccccc01';
select pg_temp.expect_value(
  $$select status from public.user_prompts where id = 'cccccccc-cccc-cccc-cccc-cccccccccc01'$$,
  'approved', 'a reviewer can approve a prompt');

update public.user_prompts set updated_at = now() where id = 'cccccccc-cccc-cccc-cccc-cccccccccc01';
select pg_temp.expect_value(
  $$select status from public.user_prompts where id = 'cccccccc-cccc-cccc-cccc-cccccccccc01'$$,
  'approved', 'a write that keeps the text keeps the approval');

update public.user_prompts set body = 'Sneaky body' where id = 'cccccccc-cccc-cccc-cccc-cccccccccc01';
select pg_temp.expect_value(
  $$select status || ':' || (approved_hash is null)::text || ':' || (reviewed_by is null)::text from public.user_prompts where id = 'cccccccc-cccc-cccc-cccc-cccccccccc01'$$,
  'pending:true:true', 'editing an approved prompt sends it back to pending and clears the approval');

update public.user_prompts
set status = 'approved', approved_hash = content_hash,
    reviewed_by = 'dddddddd-dddd-dddd-dddd-dddddddddddd', reviewed_at = now()
where id = 'cccccccc-cccc-cccc-cccc-cccccccccc01';

insert into public.user_prompts (id, owner_id, slug, title, body)
values ('cccccccc-cccc-cccc-cccc-cccccccccc02', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'my-prompt', 'Other', 'Other body');
select pg_temp.expect_state(
  $$update public.user_prompts
    set status = 'approved', approved_hash = content_hash,
        reviewed_by = 'dddddddd-dddd-dddd-dddd-dddddddddddd', reviewed_at = now()
    where id = 'cccccccc-cccc-cccc-cccc-cccccccccc02'$$,
  '23505', 'two approved prompts cannot share a slug');
select pg_temp.expect_state(
  $$insert into public.user_prompts (owner_id, slug, title, body)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'my-prompt', 'Dup', 'Dup body')$$,
  '23505', 'an owner cannot reuse a slug');
select pg_temp.expect_state(
  $$insert into public.user_prompts (owner_id, slug, title, body)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Bad Slug', 'T', 'B')$$,
  '23514', 'a malformed slug is rejected');
select pg_temp.expect_state(
  $$insert into public.user_prompts (owner_id, slug, title, body)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'empty-body', 'T', '')$$,
  '23514', 'an empty body is rejected');
select pg_temp.expect_state(
  $$insert into public.user_prompts (owner_id, slug, title, body)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'long-body', 'T', repeat('x', 20001))$$,
  '23514', 'an over-long body is rejected');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select pg_temp.expect_state(
  $$select * from public.user_prompts$$,
  '42501', 'authenticated cannot read user_prompts');
select pg_temp.expect_state(
  $$insert into public.user_prompts (owner_id, slug, title, body)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'from-session', 'T', 'B')$$,
  '42501', 'authenticated cannot write user_prompts');
select pg_temp.expect_state(
  $$update public.user_prompts set status = 'approved'$$,
  '42501', 'authenticated cannot approve its own prompt');

reset role;
set local role anon;
select pg_temp.expect_state(
  $$select * from public.user_prompts$$,
  '42501', 'anon cannot read user_prompts');

reset role;
set local role service_role;
select pg_temp.expect_state(
  $$select * from public.user_prompts$$,
  'ok', 'service_role can read user_prompts');
select pg_temp.expect_state(
  $$delete from public.user_prompts where id = 'cccccccc-cccc-cccc-cccc-cccccccccc02'$$,
  'ok', 'service_role can delete a prompt');

rollback;
