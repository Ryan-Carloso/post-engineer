-- ============================================================================
-- Migration 018 — refund_batch_tokens: record the failed engine task id
-- ----------------------------------------------------------------------------
-- Applied automatically: the deploy workflow runs `supabase db push` (pending
-- only) on every merge to main. Never apply by hand in the dashboard.
-- Safe to re-run (idempotent): DROP IF EXISTS + CREATE, no DDL on tables.
--
-- WHY: migration 017's refund_batch_tokens RPC writes the refund into
-- token_transactions but leaves engine_task_id NULL: the billing history
-- shows "refunded" with no link to the task that failed, so nobody can
-- answer "which generation failed and why was it refunded" from the ledger.
-- This extends the RPC with an optional, backward-compatible p_engine_task_id
-- parameter written into token_transactions.engine_task_id. Callers that do
-- not pass it (e.g. the web generate-and-schedule route) keep working via
-- the DEFAULT NULL.
--
-- DROP + CREATE instead of CREATE OR REPLACE: PostgreSQL cannot change a
-- function's signature with OR REPLACE — the extra parameter would create a
-- second overload and PostgREST would answer 300 Multiple Choices on every
-- rpc/refund_batch_tokens call. The function is only invoked at runtime,
-- never during a deploy, so the brief drop is safe.
--
-- Semantics are otherwise identical to 017 (idempotent per p_refund_key,
-- capped at the batch charge, restores the free/paid split, answers
-- {refunded: bool}).
-- ============================================================================

drop function if exists public.refund_batch_tokens(uuid, text, text, numeric, text);

create function public.refund_batch_tokens(
  p_user_id uuid,
  p_batch_generation_id text,
  p_refund_key text,
  p_amount numeric,
  p_reason text,
  p_engine_task_id text default null
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
    (user_id, amount, type, reason, description, generation_id, reference_id,
     free_amount, engine_task_id)
  values
    (p_user_id, credit, 'generation_refund', p_reason, p_reason,
     p_batch_generation_id, p_refund_key, free_part, p_engine_task_id)
  returning id into refund_id;

  return jsonb_build_object('refunded', true, 'transaction_id', refund_id, 'amount', credit);
end;
$$;
