-- ============================================================================
-- 080 — Public read-only share links (issue #645, first slice).
-- share_links: one row per link the owner created. The token is never stored,
-- only its SHA-256 hash (hex). persona_ids null = every persona; a list limits
-- what the public page may show to those personas. expires_at null = never.
-- Owners may read their rows (without token_hash: column grant) and revoke
-- them (update of revoked_at only); inserts and the public lookup come from
-- the service role only.
--
-- create_share_link: inserts a link unless the user already holds p_max active
-- (not revoked, not expired) links; one advisory lock per user keeps the cap
-- exact under concurrent creates. Returns no row when the cap is reached.
-- Service role only.
--
-- share_week_posts: the posts of the week [p_from, p_to) of one owner for the
-- public page. p_persona_ids null reads every post of the owner (a post whose
-- schedule was deleted has no network and is kept). A list keeps only the
-- posts whose schedule belongs to the owner and to one of those personas, so
-- the scope is decided inside one query with no row cap. Returns only title,
-- slot time, status and the networks of the schedule. Service role only.
-- Idempotent.
-- ============================================================================

create table if not exists public.share_links (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null,
  token_hash text not null unique,
  persona_ids uuid[],
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_viewed_at timestamptz
);

create index if not exists share_links_user_created_idx
  on public.share_links (user_id, created_at desc);

alter table public.share_links enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'share_links'
      and policyname = 'share_links_select_own'
  ) then
    create policy share_links_select_own on public.share_links
      for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'share_links'
      and policyname = 'share_links_update_own'
  ) then
    create policy share_links_update_own on public.share_links
      for update to authenticated
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

revoke all on table public.share_links from anon, authenticated;
grant select (id, user_id, persona_ids, created_at, expires_at, revoked_at, last_viewed_at)
  on table public.share_links to authenticated;
grant update (revoked_at) on table public.share_links to authenticated;

drop function if exists public.create_share_link(uuid, text, uuid[], timestamptz, integer);

create or replace function public.create_share_link(
  p_user_id uuid,
  p_token_hash text,
  p_persona_ids uuid[],
  p_expires_at timestamptz,
  p_max integer
)
returns table (
  id uuid,
  persona_ids uuid[],
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('share_links:' || p_user_id::text, 0));
  if (
    select count(*) from public.share_links sl
    where sl.user_id = p_user_id
      and sl.revoked_at is null
      and (sl.expires_at is null or sl.expires_at > now())
  ) >= p_max then
    return;
  end if;
  return query
    insert into public.share_links (user_id, token_hash, persona_ids, expires_at)
    values (p_user_id, p_token_hash, p_persona_ids, p_expires_at)
    returning share_links.id, share_links.persona_ids, share_links.created_at, share_links.expires_at;
end;
$$;

drop function if exists public.share_week_posts(uuid, uuid[], timestamptz, timestamptz, integer);

create or replace function public.share_week_posts(
  p_user_id uuid,
  p_persona_ids uuid[],
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer
)
returns table (
  title text,
  slot_at timestamptz,
  status text,
  providers text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select sp.title, sp.slot_at, sp.status, coalesce(s.providers, '{}')
  from public.scheduled_posts sp
  left join public.schedules s on s.id = sp.schedule_id and s.user_id = p_user_id
  where sp.user_id = p_user_id
    and sp.slot_at >= p_from
    and sp.slot_at < p_to
    and sp.status in ('pending', 'generating', 'ready', 'publishing', 'published', 'failed')
    and (p_persona_ids is null or s.persona_id = any(p_persona_ids))
  order by sp.slot_at asc, sp.id asc
  limit p_limit;
$$;

do $$
begin
  revoke execute on function public.create_share_link(uuid, text, uuid[], timestamptz, integer) from public;
  revoke execute on function public.share_week_posts(uuid, uuid[], timestamptz, timestamptz, integer) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.create_share_link(uuid, text, uuid[], timestamptz, integer) from anon;
    revoke execute on function public.share_week_posts(uuid, uuid[], timestamptz, timestamptz, integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.create_share_link(uuid, text, uuid[], timestamptz, integer) from authenticated;
    revoke execute on function public.share_week_posts(uuid, uuid[], timestamptz, timestamptz, integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.create_share_link(uuid, text, uuid[], timestamptz, integer) to service_role;
    grant execute on function public.share_week_posts(uuid, uuid[], timestamptz, timestamptz, integer) to service_role;
  end if;
end $$;
