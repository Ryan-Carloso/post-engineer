//---------------
// batch-clawback — keeps a cancel from leaving a free batch video behind.
//
// The batch discount (issue #487) makes the cheapest face video of every 6
// free by crediting its charge (a generation_refund under its own schedule).
// That credit uses up the schedule's refund cap. Without this step, a user
// could create 6, cancel the 5 paid ones and keep the free one.
//
// settle_batch_clawback (migration 046) does the money in one transaction:
// it refunds the cancelled slots in full, then pulls the discount back out
// of the free slot's discount refund row and moves that amount onto
// charged_tokens. The net is the old withhold, and the cap has room again
// so a later refund of the re-charged video returns the tokens. A failed
// slot is not clawed: its discount is the refund for a video we did not
// deliver.
//
// The slot update re-checks discount_tokens and charged_tokens. When two
// cancels of the same batch race, only one of them claws a given discount.
//---------------

import type { SupabaseClient } from '@supabase/supabase-js';

import { logger } from '@/lib/logger';
import {
  BATCH_SLOT_COLUMNS,
  batchChargeId,
  batchDiscountRefundKey,
  batchSlotRefundKey,
  narrowBatchSlot,
  planBatchClawback,
  type BatchSlot,
} from '@/lib/billing/batch-discount';

export const CANCEL_REFUND_REASON = 'Schedule cancelled before publish; video refunded';

export interface ClawbackSlot {
  id: string;
  batchId: string | null;
  chargedTokens: number;
  taskId: string | null;
}

export interface SettledRefund {
  slotId: string;
  refunded: boolean;
  alreadyRefunded: boolean;
}

export type ClawbackResult =
  | { ok: true; refundBySlot: Map<string, number>; settledSlotIds: ReadonlySet<string>; settledBySlot: ReadonlyMap<string, SettledRefund> }
  | { ok: false; error: unknown };

interface SettleRecharge {
  slotId: string;
  take: number;
}

interface SettleRefund {
  slotId: string;
  refunded: boolean;
  alreadyRefunded: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseSettle(data: unknown): { recharges: SettleRecharge[]; refunds: SettleRefund[] } | null {
  if (!isRecord(data) || data.ok !== true) return null;
  if (!Array.isArray(data.recharges) || !Array.isArray(data.refunds)) return null;
  const recharges: SettleRecharge[] = [];
  for (const item of data.recharges) {
    if (!isRecord(item) || typeof item.slot_id !== 'string') return null;
    if (typeof item.take !== 'number' || !Number.isInteger(item.take) || item.take < 0) return null;
    recharges.push({ slotId: item.slot_id, take: item.take });
  }
  const refunds: SettleRefund[] = [];
  for (const item of data.refunds) {
    if (!isRecord(item) || typeof item.slot_id !== 'string') return null;
    refunds.push({
      slotId: item.slot_id,
      refunded: item.refunded === true,
      alreadyRefunded: item.already_refunded === true,
    });
  }
  return { recharges, refunds };
}

async function readBatch(
  supabase: SupabaseClient,
  userId: string,
  batchId: string,
): Promise<{ ok: true; slots: BatchSlot[] } | { ok: false; error: unknown }> {
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select(BATCH_SLOT_COLUMNS)
    .eq('user_id', userId)
    .eq('batch_id', batchId);
  if (error) return { ok: false, error };
  const slots: BatchSlot[] = [];
  for (const raw of data ?? []) {
    const slot = narrowBatchSlot(raw);
    if (slot === null) return { ok: false, error: 'unreadable batch slot row' };
    slots.push(slot);
  }
  return { ok: true, slots };
}

/**
 * The refund each removed slot gets after the clawback. A slot outside any
 * batch keeps its full charge. A batch that cannot be read, or whose
 * settlement fails, fails the whole computation: refunding blind would let
 * the free video survive. Slots in `settledSlotIds` were already refunded
 * inside settle_batch_clawback; the caller must not refund them again.
 * `refundBySlot` is the net the user keeps (full charge minus the discount
 * pulled back), which is what `batchDiscountWithheld` is computed from.
 * The caller passes only slots whose generation never ran: a generated
 * slot keeps its charge and never enters the settlement, so cancelling it
 * cannot claw the free video's discount.
 */
export async function refundsAfterClawback(
  supabase: SupabaseClient,
  userId: string,
  removed: ClawbackSlot[],
  scheduleId: string,
): Promise<ClawbackResult> {
  const refundBySlot = new Map<string, number>(removed.map((slot) => [slot.id, slot.chargedTokens]));
  const settledSlotIds = new Set<string>();
  const settledBySlot = new Map<string, SettledRefund>();
  const batchIds = [...new Set(removed.map((slot) => slot.batchId).filter((id): id is string => id !== null))];
  for (const batchId of batchIds) {
    const batch = await readBatch(supabase, userId, batchId);
    if (!batch.ok) return { ok: false, error: batch.error };
    const inBatch = removed.filter((slot) => slot.batchId === batchId);
    let budget = inBatch.reduce((sum, slot) => sum + slot.chargedTokens, 0);
    const planned: { free: BatchSlot; take: number }[] = [];
    for (const free of planBatchClawback(batch.slots)) {
      const take = Math.min(free.discountTokens, budget);
      if (take <= 0) break;
      planned.push({ free, take });
      budget -= take;
    }
    if (planned.length === 0) continue;

    const { data, error } = await supabase.rpc('settle_batch_clawback', {
      p_user_id: userId,
      p_refunds: inBatch
        .filter((slot) => slot.chargedTokens > 0)
        .map((slot) => ({
          slot_id: slot.id,
          generation_id: batchChargeId(scheduleId),
          refund_key: batchSlotRefundKey(scheduleId, slot.id),
          amount: slot.chargedTokens,
          reason: CANCEL_REFUND_REASON,
          engine_task_id: slot.taskId,
        })),
      p_recharges: planned.map(({ free, take }) => ({
        slot_id: free.id,
        take,
        expected_charged: free.chargedTokens,
        expected_discount: free.discountTokens,
        discount_key: batchDiscountRefundKey(free.scheduleId, free.id),
      })),
    });
    const settled = parseSettle(data);
    if (error || settled === null) {
      logger.error('[api/schedule] batch clawback settlement failed', error ?? data, {
        userId,
        batchId,
      });
      return { ok: false, error: error ?? data };
    }

    let withheld = settled.recharges.reduce((sum, item) => sum + item.take, 0);
    for (const slot of inBatch) {
      settledSlotIds.add(slot.id);
      const portion = Math.min(withheld, slot.chargedTokens);
      refundBySlot.set(slot.id, slot.chargedTokens - portion);
      withheld -= portion;
      const outcome = settled.refunds.find((refund) => refund.slotId === slot.id);
      if (outcome) {
        settledBySlot.set(slot.id, {
          slotId: slot.id,
          refunded: outcome.refunded,
          alreadyRefunded: outcome.alreadyRefunded,
        });
      }
    }
  }
  return { ok: true, refundBySlot, settledSlotIds, settledBySlot };
}
