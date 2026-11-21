-- prompt_versions: every text a video was generated from, kept forever.
-- An experiment is now a comparison of prompts: each video records the
-- prompt version it was written with, and results compare versions inside
-- one account. The paired A/B experiments of 041/042 are dropped.
--
-- A version row is immutable. A user prompt gets a new version when it is
-- created and whenever its body changes (an AFTER trigger on user_prompts,
-- in the same transaction as the write). Title, description and visibility
-- changes create no version: they do not change what a video says.
-- Visibility is never copied: a version is visible when its prompt is.
-- Deleting a prompt keeps its versions (prompt_id becomes null) with the
-- slug and title they had, so old posts still name what they used.
--
-- Official prompts (shared/prompt-base) live in code, not in user_prompts.
-- ensure_official_prompt_version() records one version per distinct body
-- hash, so a deploy that changes an official prompt yields its next version.
--
-- Breaking change (beta): experiments, experiment_variants, their columns
-- on scheduled_posts and post_metrics, the snapshot trigger and
-- create_experiment() are dropped with their data.

create table if not exists public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  prompt_id uuid,
  owner_id uuid,
  source text not null check (source in ('official', 'user')),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  title text not null check (char_length(title) between 1 and 120),
  version integer not null check (version >= 1),
  body text not null check (char_length(body) >= 1),
  body_hash text not null check (body_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint prompt_versions_owner_source_check check ((owner_id is not null) = (source <> 'official')),
  constraint prompt_versions_prompt_version_unique unique (prompt_id, version)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'prompt_versions_prompt_id_fkey') then
    alter table public.prompt_versions
      add constraint prompt_versions_prompt_id_fkey
      foreign key (prompt_id) references public.user_prompts(id) on delete set null;
  end if;
end $$;

create unique index if not exists prompt_versions_official_hash_unique
  on public.prompt_versions (slug, body_hash)
  where source = 'official';

create unique index if not exists prompt_versions_official_version_unique
  on public.prompt_versions (slug, version)
  where source = 'official';

create index if not exists prompt_versions_owner_idx
  on public.prompt_versions (owner_id)
  where owner_id is not null;

create or replace function public.prompt_versions_body_hash(p_body text)
returns text
language sql
immutable
as $$
  select encode(sha256(convert_to(p_body, 'UTF8')), 'hex')
$$;

create or replace function public.prompt_versions_guard_update()
returns trigger
language plpgsql
as $$
begin
  if new.prompt_id is not null and new.prompt_id is distinct from old.prompt_id then
    raise exception 'prompt_versions rows are immutable' using errcode = '55000';
  end if;
  if (new.id, new.owner_id, new.source, new.slug, new.title, new.version, new.body, new.body_hash, new.created_at)
     is distinct from
     (old.id, old.owner_id, old.source, old.slug, old.title, old.version, old.body, old.body_hash, old.created_at) then
    raise exception 'prompt_versions rows are immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists prompt_versions_guard_update on public.prompt_versions;
create trigger prompt_versions_guard_update
  before update on public.prompt_versions
  for each row execute function public.prompt_versions_guard_update();

create or replace function public.user_prompts_record_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text := public.prompt_versions_body_hash(new.body);
  v_latest_hash text;
  v_latest_version integer;
begin
  select pv.body_hash, pv.version
    into v_latest_hash, v_latest_version
  from public.prompt_versions pv
  where pv.prompt_id = new.id
  order by pv.version desc
  limit 1;
  if v_latest_hash is not null and v_latest_hash = v_hash then
    return null;
  end if;
  insert into public.prompt_versions (prompt_id, owner_id, source, slug, title, version, body, body_hash)
  values (new.id, new.owner_id, 'user', new.slug, new.title, coalesce(v_latest_version, 0) + 1, new.body, v_hash);
  return null;
end;
$$;

drop trigger if exists user_prompts_record_version on public.user_prompts;
create trigger user_prompts_record_version
  after insert or update of body on public.user_prompts
  for each row execute function public.user_prompts_record_version();

insert into public.prompt_versions (prompt_id, owner_id, source, slug, title, version, body, body_hash)
select up.id, up.owner_id, 'user', up.slug, up.title, 1, up.body, public.prompt_versions_body_hash(up.body)
from public.user_prompts up
where not exists (select 1 from public.prompt_versions pv where pv.prompt_id = up.id);

create or replace function public.ensure_official_prompt_version(p_slug text, p_title text, p_body text)
returns table (version_id uuid, version integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text := public.prompt_versions_body_hash(p_body);
  v_id uuid;
  v_version integer;
begin
  perform pg_advisory_xact_lock(hashtext('prompt_versions:official:' || p_slug));
  select pv.id, pv.version into v_id, v_version
  from public.prompt_versions pv
  where pv.source = 'official' and pv.slug = p_slug and pv.body_hash = v_hash;
  if v_id is null then
    select coalesce(max(pv.version), 0) + 1 into v_version
    from public.prompt_versions pv
    where pv.source = 'official' and pv.slug = p_slug;
    insert into public.prompt_versions (prompt_id, owner_id, source, slug, title, version, body, body_hash)
    values (null, null, 'official', p_slug, p_title, v_version, p_body, v_hash)
    returning id into v_id;
  end if;
  return query select v_id, v_version;
end;
$$;

alter table public.prompt_versions enable row level security;
revoke all on table public.prompt_versions from anon, authenticated;

revoke execute on function public.ensure_official_prompt_version(text, text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.ensure_official_prompt_version(text, text, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.ensure_official_prompt_version(text, text, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.ensure_official_prompt_version(text, text, text) to service_role;
  end if;
end $$;

alter table public.scheduled_posts add column if not exists prompt_version_id uuid;
alter table public.post_metrics add column if not exists prompt_version_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scheduled_posts_prompt_version_id_fkey') then
    alter table public.scheduled_posts
      add constraint scheduled_posts_prompt_version_id_fkey
      foreign key (prompt_version_id) references public.prompt_versions(id) on delete set null;
  end if;
end $$;

create index if not exists post_metrics_user_prompt_version_idx
  on public.post_metrics (user_id, prompt_version_id)
  where prompt_version_id is not null;

create or replace function public.post_metrics_set_prompt_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.prompt_version_id is null then
    select sp.prompt_version_id
      into new.prompt_version_id
    from public.scheduled_posts sp
    where sp.id = new.post_id;
  end if;
  return new;
end;
$$;

drop trigger if exists post_metrics_set_prompt_version_trg on public.post_metrics;
create trigger post_metrics_set_prompt_version_trg
  before insert on public.post_metrics
  for each row execute function public.post_metrics_set_prompt_version();

drop trigger if exists post_metrics_set_experiment_trg on public.post_metrics;
drop function if exists public.post_metrics_set_experiment();
drop function if exists public.create_experiment(uuid, text, text, uuid, integer, jsonb);

alter table public.scheduled_posts drop constraint if exists scheduled_posts_experiment_variant_fkey;
alter table public.scheduled_posts drop constraint if exists scheduled_posts_experiment_link_check;
alter table public.scheduled_posts drop constraint if exists scheduled_posts_experiment_pair_variant_key;
alter table public.scheduled_posts drop column if exists experiment_id;
alter table public.scheduled_posts drop column if exists variant_id;
alter table public.scheduled_posts drop column if exists experiment_pair;

drop index if exists public.post_metrics_user_experiment_idx;
alter table public.post_metrics drop column if exists experiment_id;
alter table public.post_metrics drop column if exists variant_id;
alter table public.post_metrics drop column if exists experiment_pair;

drop table if exists public.experiment_variants;
drop table if exists public.experiments;
