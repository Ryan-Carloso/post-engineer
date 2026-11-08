//---------------
// apply — the database side of POST /api/videos/batch-discount, extracted so
// the route file exports only its handler.
//
// Service-role client: every query is scoped by user_id explicitly, because
// the service role bypasses RLS.
//---------------

import type { SupabaseClient } from '@supabase/supabase-js';

import { logger } from '@/lib/logger';
import {
  BATCH_SLOT_COLUMNS,
  batchChargeId,
  batchDiscountRefundKey,
  narrowBatchSlot,
  planBatchDiscount,
  type BatchSlot,
} from '@/lib/billing/batch-discount';

/** Stable warning codes: a committed batch never answers a bare 500. */
export const BATCH_DISCOUNT_WARNING_CODES = {
  CREDIT_FAILED: 'BATCH_DISCOUNT_CREDIT_FAILED',
  SLOT_UPDATE_FAILED: 'BATCH_DISCOUNT_SLOT_UPDATE_FAILED',
} as const;
export type BatchDiscountWarningCode =
  (typeof BATCH_DISCOUNT_WARNING_CODES)[keyof typeof BATCH_DISCOUNT_WARNING_CODES];

export const BATCH_DISCOUNT_REASON = 'Batch discount: free video (every 6th face video)';

export type ReadSlotsResult =
  | { ok: true; slots: BatchSlot[]; batchIds: (string | null)[] }
  | { ok: false; error: unknown; unreadable?: boolean };

/** Read slot rows for a filter; any unreadable row fails the whole read. */
async function readSlots(
  supabase: SupabaseClient,
  userId: string,
  filter: { column: 'schedule_id'; values: string[] } | { column: 'batch_id'; value: string },
): Promise<ReadSlotsResult> {
  const base = supabase.from('scheduled_posts').select(BATCH_SLOT_COLUMNS).eq('user_id', userId);
  const query =
    filter.column === 'schedule_id' ? base.in('schedule_id', filter.values) : base.eq('batch_id', filter.value);
  const { data, error } = await query.order('created_at', { ascending: true }).order('id', { ascending: true });
  if (error) return { ok: false, error };
  const slots: BatchSlot[] = [];
  const batchIds: (string | null)[] = [];
  for (const raw of data ?? []) {
    const slot = narrowBatchSlot(raw);
    if (slot === null) return { ok: false, error: 'unreadable slot row', unreadable: true };
    slots.push(slot);
    const batchId = (raw as { batch_id?: unknown }).batch_id;
    batchIds.push(typeof batchId === 'string' ? batchId : null);
  }
  return { ok: true, slots, batchIds };
}

export function readSlotsBySchedules(supabase: SupabaseClient, userId: string, scheduleIds: string[]) {
  return readSlots(supabase, userId, { column: 'schedule_id', values: scheduleIds });
}

export function readSlotsByBatch(supabase: SupabaseClient, userId: string, batchId: string) {
  return readSlots(supabase, userId, { column: 'batch_id', value: batchId });
}

/**
 * Join the slots to the batch. The predicate `batch_id is null` is the
 * check-then-act guard: a slot another batch claimed in between keeps its
 * batch, and the caller's re-read sees the conflict.
 */
export async function claimSlots(
  supabase: SupabaseClient,
  userId: string,
  batchId: string,
  slotIds: string[],
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  if (slotIds.length === 0) return { ok: true };
  const { error } = await supabase
    .from('scheduled_posts')
    .update({ batch_id: batchId })
    .eq('user_id', userId)
    .in('id', slotIds)
    .is('batch_id', null);
  return error ? { ok: false, error } : { ok: true };
}

export interface DiscountOutcome {
  newlyFree: BatchSlot[];
  warnings: BatchDiscountWarningCode[];
}

interface RefundPayload {
  refunded?: unknown;
  already_refunded?: unknown;
}

/**
 * True when the discount tokens are on the ledger for this slot.
 * `refunded` is a fresh credit. `already_refunded` is the same key, which
 * also matches a clawed-back row whose amount was shrunk to 0: that case
 * tops the row back up (migration 047) and only counts once the row holds
 * the full charge again. Anything else is not a credit.
 */
async function creditHeld(
  supabase: SupabaseClient,
  userId: string,
  slot: BatchSlot,
  payload: RefundPayload,
): Promise<boolean> {
  if (payload.refunded === true) return true;
  if (payload.already_refunded !== true) return false;
  const { data, error } = await supabase.rpc('restore_batch_discount_credit', {
    p_user_id: userId,
    p_batch_generation_id: batchChargeId(slot.scheduleId),
    p_refund_key: batchDiscountRefundKey(slot.scheduleId, slot.id),
    p_amount: slot.chargedTokens,
  });
  const restored = (data ?? {}) as { held?: unknown };
  if (error || restored.held !== true) {
    logger.error('[batch-discount] clawed-back discount was not restored', error ?? data, {
      userId,
      slotId: slot.id,
    });
    return false;
  }
  return true;
}

/**
 * Credit every slot planBatchDiscount picks. The credit goes through
 * refund_batch_tokens under the slot's own schedule charge with a
 * `:discount` key, so it is idempotent and capped at what that schedule
 * was charged (a slot whose failure was already refunded cannot be paid
 * back twice). The slot is marked free only after the credit is on the
 * ledger; the update re-checks discount_tokens = 0 in its predicate.
 */
export async function applyDiscount(
  supabase: SupabaseClient,
  userId: string,
  slots: BatchSlot[],
): Promise<DiscountOutcome> {
  const newlyFree: BatchSlot[] = [];
  const warnings: BatchDiscountWarningCode[] = [];
  for (const slot of planBatchDiscount(slots)) {
    const batchGenerationId = batchChargeId(slot.scheduleId);
    const { data, error } = await supabase.rpc('refund_batch_tokens', {
      p_user_id: userId,
      p_batch_generation_id: batchGenerationId,
      p_refund_key: batchDiscountRefundKey(slot.scheduleId, slot.id),
      p_amount: slot.chargedTokens,
      p_reason: BATCH_DISCOUNT_REASON,
      p_engine_task_id: slot.taskId,
    });
    const payload = (data ?? {}) as RefundPayload;
    if (error || !(await creditHeld(supabase, userId, slot, payload))) {
      // The RPC answering false is a real failure (billing rule): the user
      // did not get the discount. Loud log, stable warning, keep going.
      // creditHeld logs the clawed-back case itself.
      if (error || payload.already_refunded !== true) {
        logger.error('[batch-discount] discount credit failed', error ?? payload, { userId, slotId: slot.id });
      }
      warnings.push(BATCH_DISCOUNT_WARNING_CODES.CREDIT_FAILED);
      continue;
    }
    const { data: updated, error: updateError } = await supabase
      .from('scheduled_posts')
      .update({ charged_tokens: 0, discount_tokens: slot.chargedTokens })
      .eq('id', slot.id)
      .eq('user_id', userId)
      .eq('discount_tokens', 0)
      .select('id');
    if (updateError || (updated ?? []).length !== 1) {
      // The credit landed but the slot still reads as paid: a later failure
      // refund of this slot is capped by the RPC at the schedule charge, so
      // it can never pay back more than was charged. Log loudly.
      logger.error('[batch-discount] free slot could not be marked', updateError ?? null, { userId, slotId: slot.id });
      warnings.push(BATCH_DISCOUNT_WARNING_CODES.SLOT_UPDATE_FAILED);
      continue;
    }
    newlyFree.push(slot);
  }
  return { newlyFree, warnings };
}
