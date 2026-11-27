-- ============================================================================
-- Atomic slot delete guard (prevents the last-slot check-then-act race)
-- ----------------------------------------------------------------------------
-- SOURCE OF TRUTH: supabase/migrations/092_slot-delete-expired.sql
-- (the newest versioned migration that redefines it: 058's body plus a
-- pinned search_path; 065 also makes it service-role only; 089 admits
-- awaiting_approval slots; 092 admits expired slots). This file keeps the same body for reference,
-- pinned by slot-delete-ready-migration.test.ts; do not apply it by hand —
-- the migration chain applies the function and its grants.
--
-- WHY: DELETE /api/schedule/slots checked "is this the schedule's last
-- slot?" with a SELECT and then DELETEd in two steps. Two concurrent
-- deletes of a schedule's last two slots could both see remaining >= 1 and
-- both commit, leaving an active-but-empty schedule. This function makes
-- the guard atomic: the row locks, the remaining-count check and the delete
-- happen in one transaction.
--
-- Returns: 'deleted' | 'is_last_slot' | 'not_found' | 'not_deletable'
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
