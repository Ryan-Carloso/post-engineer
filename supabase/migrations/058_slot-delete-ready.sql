-- ============================================================================
-- 058 — Ready slots are deletable (issue #555).
-- The detail page lets the owner delete a ready slot (generated, not yet
-- dispatched). The route already allows 'ready', but the atomic delete
-- guard this migration replaces still rejected it, so the RPC must allow
-- it too. The guard's safety properties are unchanged: the row locks, the
-- remaining-count check and the delete happen in one transaction, the
-- last-slot guard still applies, and no refund happens on delete. A ready
-- row the publisher has already claimed is locked by the claim's
-- conditional PATCH first, so the delete sees the new status and refuses.
-- Idempotent (CREATE OR REPLACE).
--
-- The standalone supabase/slot-delete-guard.sql keeps the same body for
-- reference; this migration is the source of truth.
-- ============================================================================

create or replace function public.delete_slot_if_not_last(
  p_slot_id uuid,
  p_user_id uuid
)
returns text
language plpgsql
security definer
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

  -- Pending (not yet dispatched), ready (generated, not yet dispatched)
  -- and failed (dead row cleanup) slots can be deleted; the engine owns
  -- everything mid-flight.
  if v_status not in ('pending', 'ready', 'failed') then
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
