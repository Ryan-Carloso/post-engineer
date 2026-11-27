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
    and sp.status in ('ready', 'publishing', 'published', 'failed', 'expired')
    and (p_persona_ids is null or s.persona_id = any(p_persona_ids))
  order by sp.slot_at asc, sp.id asc
  limit p_limit;
$$;

do $$
begin
  revoke execute on function public.share_week_posts(uuid, uuid[], timestamptz, timestamptz, integer) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.share_week_posts(uuid, uuid[], timestamptz, timestamptz, integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.share_week_posts(uuid, uuid[], timestamptz, timestamptz, integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.share_week_posts(uuid, uuid[], timestamptz, timestamptz, integer) to service_role;
  end if;
end $$;
