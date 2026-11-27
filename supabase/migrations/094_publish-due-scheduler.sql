-- 094 — the publish-due scheduler runs inside the web app.
--
-- The Python engine used to poll scheduled_posts every 60 s, claim each slot
-- with a conditional PATCH and POST it back to /api/upload-content. The web
-- scheduler now does the same in-process, and this migration holds the three
-- database pieces it needs:
--
--   1. release_scheduler_lease: the holder gives its lease back when a job
--      ends, so a 60 s tick is not blocked by a lease that only lapses on its
--      TTL (and post-metrics stops drifting to a 2 h cadence).
--   2. claim_next_publish_slot: claims ONE slot per call, atomically, and
--      returns it with the schedule and persona it needs. Claiming one slot at
--      a time means a slot never waits claimed in a batch behind a long
--      upload: after a restart the only slot stuck under a lease is the one
--      that was being published.
--   3. expire_inactive_ready_slots: the due ready slots whose owner lost access
--      become expired in one statement and come back for media cleanup.
--
-- Candidate rules (the same ones the engine applied in Python):
--   * ready      and slot_at <= p_now and (publish_not_before is null or <= p_now)
--   * publishing and (publish_not_before is null or <= p_now)  -> resumed
--   * the owner's access_until is in the future (user_profiles); an owner with
--     no profile row is never a candidate
--   * awaiting_approval, pending, failed, published and expired are never
--     claimed: scheduled_posts has no status check constraint, so the status
--     filter here is the only thing keeping them out.
-- A claim sets status = 'publishing' and publish_not_before = p_now + p_lease,
-- so a crashed worker's slot is resumed once the lease lapses. A null lease on
-- a publishing slot counts as lapsed.
--
-- Service role only, like every scheduler RPC (027): revoked from public, anon
-- and authenticated, granted to service_role.

create or replace function public.release_scheduler_lease(
  p_job text,
  p_holder text
)
returns void
language sql
as $$
  update public.scheduler_leases
  set lease_until = now()
  where job = p_job and holder = p_holder;
$$;

create or replace function public.claim_next_publish_slot(
  p_now timestamptz,
  p_lease interval
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_resumed boolean;
  v_slot jsonb;
begin
  select sp.id, sp.status = 'publishing'
  into v_id, v_resumed
  from public.scheduled_posts sp
  join public.user_profiles up on up.id = sp.user_id
  where up.access_until > p_now
    and (
      (sp.status = 'ready' and sp.slot_at <= p_now)
      or sp.status = 'publishing'
    )
    and (sp.publish_not_before is null or sp.publish_not_before <= p_now)
  order by sp.slot_at, sp.id
  limit 1
  for update of sp skip locked;

  if v_id is null then
    return null;
  end if;

  update public.scheduled_posts
  set status = 'publishing',
      publish_not_before = p_now + p_lease
  where id = v_id;

  select to_jsonb(sp)
    || jsonb_build_object(
      'resumed', v_resumed,
      'schedules', (
        select jsonb_build_object(
          'id', s.id,
          'user_id', s.user_id,
          'persona_id', s.persona_id,
          'providers', s.providers,
          'youtube_account_ids', s.youtube_account_ids,
          'instagram_account_ids', s.instagram_account_ids,
          'linkedin_account_ids', s.linkedin_account_ids,
          'bluesky_account_ids', s.bluesky_account_ids,
          'threads_account_ids', s.threads_account_ids,
          'facebook_account_ids', s.facebook_account_ids,
          'pinterest_account_ids', s.pinterest_account_ids,
          'pinterest_board_id', s.pinterest_board_id,
          'threespeak_account_ids', s.threespeak_account_ids,
          'rumble_account_ids', s.rumble_account_ids,
          'fanvue_account_ids', s.fanvue_account_ids,
          'telegram_account_ids', s.telegram_account_ids,
          'personas', (
            select jsonb_build_object('name', p.name, 'ai_label', p.ai_label)
            from public.personas p
            where p.id = s.persona_id
          )
        )
        from public.schedules s
        where s.id = sp.schedule_id
      )
    )
  into v_slot
  from public.scheduled_posts sp
  where sp.id = v_id;

  return v_slot;
end;
$$;

create or replace function public.expire_inactive_ready_slots(
  p_now timestamptz,
  p_limit integer default 100
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with due as (
    select sp.id
    from public.scheduled_posts sp
    join public.user_profiles up on up.id = sp.user_id
    where sp.status = 'ready'
      and sp.slot_at <= p_now
      and up.access_until <= p_now
    order by sp.slot_at, sp.id
    limit p_limit
    for update of sp skip locked
  ),
  expired as (
    update public.scheduled_posts sp
    set status = 'expired',
        publish_not_before = null
    from due
    where sp.id = due.id
    returning sp.id, sp.user_id, sp.title, sp.media_kind, sp.media_ref
  )
  select coalesce(jsonb_agg(to_jsonb(expired)), '[]'::jsonb) from expired;
$$;

do $$
begin
  revoke execute on function public.release_scheduler_lease(text, text) from public;
  revoke execute on function public.claim_next_publish_slot(timestamptz, interval) from public;
  revoke execute on function public.expire_inactive_ready_slots(timestamptz, integer) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.release_scheduler_lease(text, text) from anon;
    revoke execute on function public.claim_next_publish_slot(timestamptz, interval) from anon;
    revoke execute on function public.expire_inactive_ready_slots(timestamptz, integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.release_scheduler_lease(text, text) from authenticated;
    revoke execute on function public.claim_next_publish_slot(timestamptz, interval) from authenticated;
    revoke execute on function public.expire_inactive_ready_slots(timestamptz, integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.release_scheduler_lease(text, text) to service_role;
    grant execute on function public.claim_next_publish_slot(timestamptz, interval) to service_role;
    grant execute on function public.expire_inactive_ready_slots(timestamptz, integer) to service_role;
  end if;
end $$;
