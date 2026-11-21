-- Behaviour check for 078_prompt-versions.sql.
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

insert into public.user_prompts (id, owner_id, slug, title, body)
values ('dddddddd-dddd-dddd-dddd-dddddddddd01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'versioned', 'Versioned', 'First body');

select pg_temp.expect_value(
  $$select string_agg(version::text || ':' || body, ',' order by version) from public.prompt_versions
    where prompt_id = 'dddddddd-dddd-dddd-dddd-dddddddddd01'$$,
  '1:First body', 'creating a prompt records version 1');

update public.user_prompts set title = 'Renamed', visibility = 'public'
  where id = 'dddddddd-dddd-dddd-dddd-dddddddddd01';
update public.user_prompts set body = 'First body'
  where id = 'dddddddd-dddd-dddd-dddd-dddddddddd01';
select pg_temp.expect_value(
  $$select count(*)::text from public.prompt_versions where prompt_id = 'dddddddd-dddd-dddd-dddd-dddddddddd01'$$,
  '1', 'title, visibility and an unchanged body create no version');

update public.user_prompts set body = 'Second body'
  where id = 'dddddddd-dddd-dddd-dddd-dddddddddd01';
select pg_temp.expect_value(
  $$select string_agg(version::text || ':' || title || ':' || body, ',' order by version) from public.prompt_versions
    where prompt_id = 'dddddddd-dddd-dddd-dddd-dddddddddd01'$$,
  '1:Versioned:First body,2:Renamed:Second body', 'a new body records the next version and keeps the old one');

select pg_temp.expect_state(
  $$update public.prompt_versions set body = 'tampered' where prompt_id = 'dddddddd-dddd-dddd-dddd-dddddddddd01'$$,
  '55000', 'a version body cannot change');
select pg_temp.expect_state(
  $$update public.prompt_versions set prompt_id = 'dddddddd-dddd-dddd-dddd-dddddddddd99'
    where prompt_id = 'dddddddd-dddd-dddd-dddd-dddddddddd01'$$,
  '55000', 'a version cannot move to another prompt');

delete from public.user_prompts where id = 'dddddddd-dddd-dddd-dddd-dddddddddd01';
select pg_temp.expect_value(
  $$select count(*)::text from public.prompt_versions
    where slug = 'versioned' and owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and prompt_id is null$$,
  '2', 'deleting a prompt keeps its versions, unlinked');

create temporary table official_ids (label text, id uuid, version integer) on commit drop;
insert into official_ids select 'a', * from public.ensure_official_prompt_version('story-first', 'Story first', 'Body one');
insert into official_ids select 'b', * from public.ensure_official_prompt_version('story-first', 'Story first', 'Body one');
insert into official_ids select 'c', * from public.ensure_official_prompt_version('story-first', 'Story first', 'Body two');
select pg_temp.expect_value(
  $$select (select id from official_ids where label = 'a') = (select id from official_ids where label = 'b')$$,
  'true', 'the same official body maps to the same version');
select pg_temp.expect_value(
  $$select string_agg(label || ':' || version::text, ',' order by label) from official_ids$$,
  'a:1,b:1,c:2', 'a changed official body records the next version');

insert into public.schedules (id, user_id, providers, youtube_account_ids, instagram_account_ids, times, linkedin_account_ids, bluesky_account_ids)
values ('dddddddd-dddd-dddd-dddd-dddddddddd03', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', array['youtube'], array[]::text[], array[]::text[], array[]::text[], array[]::text[], array[]::text[]);
insert into public.scheduled_posts (id, schedule_id, user_id, slot_at, charged_tokens, prompt_version_id)
select 'dddddddd-dddd-dddd-dddd-dddddddddd02', 'dddddddd-dddd-dddd-dddd-dddddddddd03', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now(), 1, id
from official_ids where label = 'c';
insert into public.post_metrics (post_id, user_id, provider, account_id, external_id, metrics_window)
values ('dddddddd-dddd-dddd-dddd-dddddddddd02', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'youtube', 'acc', 'ext', '7d');
select pg_temp.expect_value(
  $$select (pm.prompt_version_id = (select id from official_ids where label = 'c'))::text
    from public.post_metrics pm where pm.post_id = 'dddddddd-dddd-dddd-dddd-dddddddddd02'$$,
  'true', 'a metrics snapshot copies the prompt version of its post');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select pg_temp.expect_state($$select * from public.prompt_versions$$, '42501', 'authenticated cannot read prompt_versions');
select pg_temp.expect_state(
  $$select public.ensure_official_prompt_version('x', 'X', 'X')$$,
  '42501', 'authenticated cannot record an official version');

reset role;
set local role anon;
select pg_temp.expect_state($$select * from public.prompt_versions$$, '42501', 'anon cannot read prompt_versions');

reset role;
set local role service_role;
select pg_temp.expect_state($$select * from public.prompt_versions$$, 'ok', 'service_role can read prompt_versions');

rollback;
