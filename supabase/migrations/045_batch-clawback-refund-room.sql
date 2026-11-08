-- ============================================================================
-- Migration 045 — batch clawback restores refund room
-- ----------------------------------------------------------------------------
-- Applied automatically: the deploy workflow runs `supabase db push` (pending
-- only) on every merge to main. Never apply by hand in the dashboard.
-- Safe to re-run (idempotent): CREATE OR REPLACE, no DDL on tables.
--
-- WHY: the batch discount credits the free video by refunding its whole
-- schedule charge (refund_batch_tokens under batch:<scheduleId>, key
-- ...:discount). That credit uses up the charge cap. The cancel clawback
-- then writes the discount back into scheduled_posts.charged_tokens and
-- withholds it from the cancelled sibling, but the ledger cap stays full.
-- A later refund of the re-charged video (generation failure, or cancelling
-- that video itself) answers nothing_to_refund, and the user loses the
-- tokens the clawback just treated as paid.
--
-- settle_batch_clawback does the money movement in one transaction:
--   1. Lock the balance row.
--   2. Refund each cancelled slot in full (the existing cap and idempotency
--      key). This is what funds the pull-back, so a user who already spent
--      the discount is not driven negative.
--   3. For each free slot the caller planned, re-check charged_tokens and
--      discount_tokens (and skip failed slots) and move `take` back onto
--      charged_tokens.
--   4. Shrink that slot's discount refund row by the same `take` and pull
--      the tokens off the balance. The cap is "sum of generation_refund
--      under the charge", so shrinking the discount row opens room for a
--      later refund of exactly the re-charged amount.
--
-- Net tokens equal the old withhold. The discount row is kept even at
-- amount 0 so a retry of the discount credit still sees the refund key.
-- A missing discount row after a successful slot update raises, which rolls
-- the refunds back: refunding blind would leave the free video in place.
-- ============================================================================

create or replace function public.settle_batch_clawback(
  p_user_id uuid,
  p_refunds jsonb,
  p_recharges jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refunds jsonb := coalesce(p_refunds, '[]'::jsonb);
  recharges jsonb := coalesce(p_recharges, '[]'::jsonb);
  idx integer;
  refund_item jsonb;
  recharge_item jsonb;
  payload jsonb;
  credited numeric := 0;
  take numeric;
  row_id uuid;
  row_amount numeric;
  row_free numeric;
  updated_id uuid;
  free_bal numeric;
  paid_bal numeric;
  free_back numeric;
  paid_back numeric;
  new_amount numeric;
  new_free numeric;
  applied_refunds jsonb := '[]'::jsonb;
  applied_recharges jsonb := '[]'::jsonb;
begin
  if p_user_id is null then
    raise exception 'user id is required';
  end if;
  if jsonb_typeof(refunds) <> 'array' or jsonb_typeof(recharges) <> 'array' then
    raise exception 'clawback payloads must be arrays';
  end if;

  -- Serialize against spends and other refunds of this user.
  perform 1
  from public.user_profiles
  where id = p_user_id
  for update;

  for idx in 0 .. jsonb_array_length(refunds) - 1 loop
    refund_item := refunds -> idx;
    if coalesce((refund_item->>'amount')::numeric, 0) <= 0 then
      raise exception 'clawback refund amount must be positive';
    end if;
    payload := public.refund_batch_tokens(
      p_user_id,
      refund_item->>'generation_id',
      refund_item->>'refund_key',
      (refund_item->>'amount')::numeric,
      coalesce(refund_item->>'reason', 'Schedule cancelled before publish; video refunded'),
      nullif(refund_item->>'engine_task_id', '')
    );
    if coalesce((payload->>'refunded')::boolean, false) then
      credited := credited + coalesce((payload->>'amount')::numeric, 0);
    end if;
    applied_refunds := applied_refunds || jsonb_build_array(
      jsonb_build_object(
        'slot_id', refund_item->>'slot_id',
        'refunded', coalesce((payload->>'refunded')::boolean, false),
        'already_refunded', coalesce((payload->>'already_refunded')::boolean, false),
        'amount', coalesce((payload->>'amount')::numeric, 0)
      )
    );
  end loop;

  for idx in 0 .. jsonb_array_length(recharges) - 1 loop
    recharge_item := recharges -> idx;
    take := least(coalesce((recharge_item->>'take')::numeric, 0), credited);
    if take <= 0 then
      continue;
    end if;
    if take <> trunc(take) then
      raise exception 'batch clawback take must be a whole number of tokens';
    end if;

    updated_id := null;
    update public.scheduled_posts
    set charged_tokens = charged_tokens + take::integer,
        discount_tokens = discount_tokens - take::integer
    where id = (recharge_item->>'slot_id')::uuid
      and user_id = p_user_id
      and status <> 'failed'
      and charged_tokens = (recharge_item->>'expected_charged')::integer
      and discount_tokens = (recharge_item->>'expected_discount')::integer
      and discount_tokens >= take::integer
    returning id into updated_id;
    if not found then
      -- Concurrent cancel already moved this discount, or the slot failed
      -- after the plan was made. The sibling refund above stands.
      continue;
    end if;

    row_id := null;
    select id, amount, coalesce(free_amount, 0)
    into row_id, row_amount, row_free
    from public.token_transactions
    where user_id = p_user_id
      and reference_id = recharge_item->>'discount_key'
      and type = 'generation_refund'
    for update;
    if not found or row_amount < take then
      raise exception 'batch clawback discount refund missing for slot %', recharge_item->>'slot_id';
    end if;

    select tokens_balance, free_tokens_balance
    into paid_bal, free_bal
    from public.user_profiles
    where id = p_user_id;
    if not found or paid_bal is null or free_bal is null then
      raise exception 'batch clawback user balance is missing';
    end if;

    free_back := least(take, free_bal);
    paid_back := take - free_back;
    if paid_back > paid_bal then
      raise exception 'batch clawback would drive the balance negative';
    end if;

    new_amount := row_amount - take;
    new_free := least(greatest(row_free - free_back, 0), new_amount);

    update public.user_profiles
    set tokens_balance = tokens_balance - paid_back,
        free_tokens_balance = free_tokens_balance - free_back
    where id = p_user_id;

    update public.token_transactions
    set amount = new_amount,
        free_amount = new_free
    where id = row_id;

    credited := credited - take;
    applied_recharges := applied_recharges || jsonb_build_array(
      jsonb_build_object('slot_id', recharge_item->>'slot_id', 'take', take)
    );
  end loop;

  return jsonb_build_object('ok', true, 'refunds', applied_refunds, 'recharges', applied_recharges);
end;
$$;
