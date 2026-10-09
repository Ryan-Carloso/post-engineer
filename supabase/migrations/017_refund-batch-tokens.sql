-- ============================================================================
-- Migration 017 — refund_batch_tokens RPC (per-slot refund of a prepaid batch)
-- ----------------------------------------------------------------------------
-- Applied automatically: the deploy workflow runs `supabase db push` (pending
-- only) on every merge to main. Never apply by hand in the dashboard.
-- Safe to re-run (idempotent): create or replace, no DDL on tables.
--
-- WHY: the engine's fill_schedule store
-- (apps/engine/app/services/fill_schedule/store.py::refund_batch_tokens) and
-- the web's generate-and-schedule route both POST rpc/refund_batch_tokens
-- for per-slot refunds of a batch prepaid under `batch:<scheduleId>`, but no
-- migration ever created the function. PostgREST answered 404 (PGRST202) on
-- every call, so failed batch slots were never refunded: the user kept being
-- charged for videos that never generated.
--
-- Semantics mirror the sibling refund_generation_tokens RPC:
--   * idempotent per p_refund_key (carried in token_transactions.reference_id;
--     generation_id stays the batch id so the ledger still ties every credit
--     to its charge),
--   * total refunds for one batch never exceed the batch charge (pricing can
--     move between spend time and refund time),
--   * restores the free/paid split: the batch spend takes free tokens first,
--     so refunds restore free first,
--   * answers {refunded: bool} — the only field both callers read.
-- ============================================================================

create or replace function public.refund_batch_tokens(
  p_user_id uuid,
  p_batch_generation_id text,
  p_refund_key text,
  p_amount numeric,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  charge_amount numeric;
  charge_free numeric;
  refunded_total numeric;
  free_restored numeric;
  credit numeric;
  free_part numeric;
  paid_part numeric;
  refund_id uuid;
begin
  if p_amount <= 0 then
    raise exception 'Token amount must be positive';
  end if;

  -- Serialize concurrent refunds of sibling slots on the balance row.
  perform 1
  from public.user_profiles
  where id = p_user_id
  for update;

  -- Idempotency: one credit per refund key, even across retries/restarts.
  if exists (
    select 1 from public.token_transactions
    where user_id = p_user_id
      and reference_id = p_refund_key
      and type = 'generation_refund'
  ) then
    return jsonb_build_object('refunded', false, 'already_refunded', true);
  end if;

  -- The batch charge: the single spend_tokens row under the batch id.
  select abs(amount), coalesce(free_amount, 0)
  into charge_amount, charge_free
  from public.token_transactions
  where user_id = p_user_id
    and generation_id = p_batch_generation_id
    and type = 'video_generation'
  order by created_at asc
  limit 1;

  if charge_amount is null then
    return jsonb_build_object('refunded', false, 'missing_charge', true);
  end if;

  -- Cap: the batch's per-slot refunds must never exceed what it was charged.
  select coalesce(sum(amount), 0)
  into refunded_total
  from public.token_transactions
  where user_id = p_user_id
    and generation_id = p_batch_generation_id
    and type = 'generation_refund';

  if refunded_total >= charge_amount then
    return jsonb_build_object('refunded', false, 'nothing_to_refund', true);
  end if;
  credit := least(p_amount, charge_amount - refunded_total);

  -- Restore the free/paid split: free tokens were spent first, so they are
  -- restored first; whatever is left over goes back to the paid balance.
  select coalesce(sum(free_amount), 0)
  into free_restored
  from public.token_transactions
  where user_id = p_user_id
    and generation_id = p_batch_generation_id
    and type = 'generation_refund';

  free_part := least(credit, greatest(charge_free - free_restored, 0));
  paid_part := credit - free_part;

  update public.user_profiles
  set tokens_balance = tokens_balance + paid_part,
      free_tokens_balance = free_tokens_balance + free_part
  where id = p_user_id;

  insert into public.token_transactions
    (user_id, amount, type, reason, description, generation_id, reference_id, free_amount)
  values
    (p_user_id, credit, 'generation_refund', p_reason, p_reason,
     p_batch_generation_id, p_refund_key, free_part)
  returning id into refund_id;

  return jsonb_build_object('refunded', true, 'transaction_id', refund_id, 'amount', credit);
end;
$$;
