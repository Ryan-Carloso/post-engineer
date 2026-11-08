-- ============================================================================
-- Migration 044 — refund_batch_tokens: cap refunds at TOTAL charges
-- ----------------------------------------------------------------------------
-- Applied automatically: the deploy workflow runs `supabase db push` (pending
-- only) on every merge to main. Never apply by hand in the dashboard.
-- Safe to re-run (idempotent): create or replace, no DDL on tables, no
-- signature change (018's DROP + CREATE is not needed here).
--
-- WHY: 017/018 capped total refunds at the OLDEST video_generation row
-- (first row by creation time): the batch was prepaid as ONE spend
-- row, so the oldest row WAS the charge. That stopped being true when the
-- generate-and-schedule read-your-ledger check went net-based: a
-- fully-refunded attempt re-charges under the SAME generation_id, leaving
-- TWO spend rows. The retry's per-slot refund then hit the cap on the old
-- math — total refunds already equalled the first charge — and returned
-- `nothing_to_refund`, so the retry's fresh charge was never returned: the
-- user paid for a failed video.
--
-- The cap now counts EVERY spend row under the generation_id (total
-- charges vs total refunds), and the free/paid restore sums free_amount
-- over every spend row the same way. With a single charge row the sums
-- equal the old oldest-row values, so existing batches behave identically.
-- Semantics are otherwise identical to 018 (idempotent per p_refund_key,
-- restores the free/paid split, answers {refunded: bool}).
-- ============================================================================

create or replace function public.refund_batch_tokens(
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

  -- Total charges: a generation may hold more than one spend row (a
  -- fully-refunded attempt re-charges under the same generation_id), so the
  -- cap counts every spend, not just the oldest one. Spend rows carry a
  -- negative amount; free_amount is how much of each spend came from free.
  select coalesce(sum(abs(amount)), 0), coalesce(sum(coalesce(free_amount, 0)), 0)
  into charge_amount, charge_free
  from public.token_transactions
  where user_id = p_user_id
    and generation_id = p_batch_generation_id
    and type = 'video_generation';

  if charge_amount = 0 then
    return jsonb_build_object('refunded', false, 'missing_charge', true);
  end if;

  -- Cap: the batch's per-slot refunds must never exceed what it was charged
  -- in total (pricing can move between spend time and refund time).
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
