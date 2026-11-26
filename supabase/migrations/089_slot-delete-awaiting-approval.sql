-- ============================================================================
-- 089 — Awaiting-approval slots are deletable (issue #806).
-- delete_slot_if_not_last admits 'awaiting_approval' alongside pending,
-- ready and failed: a slot held for the owner's approval can be deleted from
-- the Posts page, and deleting the schedule's last slot still answers
-- 'is_last_slot', so the caller deletes the schedule instead. The grants
-- from 065 are untouched: create or replace keeps them, and the search_path
-- stays pinned. Idempotent.
-- ============================================================================

create or replace function public.delete_slot_if_not_last(
  p_slot_id uuid,
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schedule_id uuid;
  v_status text;
  v_remaining int;
begin
  -- Lock the target row first so concurrent deletes serialize here.
  select schedule_id, status into v_schedule_id, v_status
  from public.scheduled_posts
  where id = p_slot_id and user_id = p_user_id
  for update;

  if not found then
    return 'not_found';
  end if;

  -- Pending (not yet dispatched), ready (generated, not yet dispatched),
  -- awaiting_approval (held for the owner's approval) and failed (dead row
  -- cleanup) slots can be deleted; the engine owns everything mid-flight.
  if v_status not in ('pending', 'ready', 'awaiting_approval', 'failed') then
    return 'not_deletable';
  end if;

  select count(*) into v_remaining
  from public.scheduled_posts
  where schedule_id = v_schedule_id and id <> p_slot_id;

  if v_remaining = 0 then
    return 'is_last_slot';
  end if;

  delete from public.scheduled_posts
  where id = p_slot_id and user_id = p_user_id;

  return 'deleted';
end;
$$;
