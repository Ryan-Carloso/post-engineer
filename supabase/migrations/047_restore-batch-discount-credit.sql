-- ============================================================================
-- Migration 047 — restore a clawed-back batch discount credit
-- ----------------------------------------------------------------------------
-- Applied automatically: the deploy workflow runs `supabase db push` (pending
-- only) on every merge to main. Never apply by hand in the dashboard.
-- Safe to re-run (idempotent): CREATE OR REPLACE, no DDL on tables.
--
-- WHY: the discount credit is one generation_refund row under a permanent
-- key (batch:<scheduleId>:slot:<slotId>:discount). Migration 046 shrinks
-- that row to amount 0 and re-charges the slot, and keeps the row so a
-- retry cannot insert a second credit. refund_batch_tokens then answers
-- already_refunded for that key even though the amount is 0. Treating that
-- as "the credit is still held" marks the slot free again (charged_tokens
-- 0) with no tokens moved, so a later refund of the slot pays nothing.
--
-- When the batch earns the free video again, restore_batch_discount_credit
-- tops that same row back up to the slot charge and returns the tokens,
-- inside the migration 044 cap (total charges, not the oldest spend row).
-- A row that already holds the full amount is left untouched, so the
-- crash-retry of a credit that did land does not pay twice. A top-up the
-- cap cannot cover in full changes nothing.
-- ============================================================================

create or replace function public.restore_batch_discount_credit(
  p_user_id uuid,
  p_batch_generation_id text,
  p_refund_key text,
  p_amount numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  charge_amount numeric;
  charge_free numeric;
  refunded_total numeric;
  free_restored numeric;
  row_id uuid;
  row_amount numeric;
  row_free numeric;
  need numeric;
  credit numeric;
  free_part numeric;
  paid_part numeric;
begin
  if p_user_id is null then
    raise exception 'batch discount restore requires a user';
  end if;
  if p_amount <= 0 or p_amount <> trunc(p_amount) then
    raise exception 'Token amount must be a positive whole number';
  end if;

  perform 1
  from public.user_profiles
  where id = p_user_id
  for update;
  if not found then
    raise exception 'batch discount restore user balance is missing';
  end if;

  select id, amount, coalesce(free_amount, 0)
  into row_id, row_amount, row_free
  from public.token_transactions
  where user_id = p_user_id
    and reference_id = p_refund_key
    and type = 'generation_refund'
  for update;
  if not found or row_amount is null then
    return jsonb_build_object('held', false, 'missing_credit', true);
  end if;

  -- The credit from the first apply is still on the row. Do not add to it.
  if row_amount >= p_amount then
    return jsonb_build_object('held', true, 'restored', false);
  end if;

  -- Same cap as refund_batch_tokens (migration 044): every spend row
  -- under the generation id counts. A retried charge leaves two rows,
  -- and the oldest row alone would refuse a top-up the cap can cover.
  select coalesce(sum(abs(amount)), 0), coalesce(sum(coalesce(free_amount, 0)), 0)
  into charge_amount, charge_free
  from public.token_transactions
  where user_id = p_user_id
    and generation_id = p_batch_generation_id
    and type = 'video_generation';
  if charge_amount = 0 then
    return jsonb_build_object('held', false, 'missing_charge', true);
  end if;

  select coalesce(sum(amount), 0)
  into refunded_total
  from public.token_transactions
  where user_id = p_user_id
    and generation_id = p_batch_generation_id
    and type = 'generation_refund';

  need := p_amount - row_amount;
  -- All or nothing. A short top-up would move tokens and still leave the
  -- slot looking unpaid, or get marked as a free video it did not pay for.
  if refunded_total + need > charge_amount then
    return jsonb_build_object('held', false, 'nothing_to_refund', true);
  end if;
  credit := need;

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

  update public.token_transactions
  set amount = row_amount + credit,
      free_amount = least(row_free + free_part, row_amount + credit)
  where id = row_id;

  return jsonb_build_object('held', true, 'restored', true, 'amount', row_amount + credit);
end;
$$;
