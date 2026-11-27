-- ============================================================================
-- 092 — Expired slots are deletable (issue #799 follow-up).
-- delete_slot_if_not_last admits 'expired' alongside pending, ready,
-- awaiting_approval and failed: a slot whose owner lost access expired
-- instead of publishing, and the Posts page offers Delete for it, but the
-- function still answered 'not_deletable', so the slot and its upload
-- reference were stuck (expired is not editable either). The grants from
-- 065 are untouched: create or replace keeps them, and the search_path
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
  -- awaiting_approval (held for the owner's approval), failed (dead row
  -- cleanup) and expired (owner lost access, never published) slots can be
  -- deleted; the engine owns everything mid-flight.
  if v_status not in ('pending', 'ready', 'awaiting_approval', 'failed', 'expired') then
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
