//---------------
// batch-clawback — keeps a cancel from leaving a free batch video behind.
//
// The batch discount (issue #487) makes the cheapest face video of every 6
// free. Without this step, a user could create 6, cancel the 5 paid ones
// (each refunded its full charge) and keep the free one. After a cancel
// removes slots, the batch's remaining slots are re-checked: every free slot
// beyond what the remaining batch still earns gets its discount moved back
// into charged_tokens, and that amount is withheld from the cancelled
// slots' refunds. This only ever lowers a refund; it never charges the user.
//
// The update re-checks the free slot's discount_tokens and charged_tokens
// in its predicate (check-then-act): when two cancels of the same batch
// race, only one of them claws a given discount back.
//---------------

import type { SupabaseClient } from '@supabase/supabase-js';

import { logger } from '@/lib/logger';
import { BATCH_SLOT_COLUMNS, narrowBatchSlot, planBatchClawback, type BatchSlot } from '@/lib/billing/batch-discount';

export interface ClawbackSlot {
  id: string;
  batchId: string | null;
  chargedTokens: number;
}

export type ClawbackResult =
  | { ok: true; refundBySlot: Map<string, number> }
  | { ok: false; error: unknown };

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
 * batch keeps its full charge. A batch that cannot be read fails the whole
 * computation: refunding blind would let the free video survive.
 */
export async function refundsAfterClawback(
  supabase: SupabaseClient,
  userId: string,
  removed: ClawbackSlot[],
): Promise<ClawbackResult> {
  const refundBySlot = new Map<string, number>(removed.map((slot) => [slot.id, slot.chargedTokens]));
  const batchIds = [...new Set(removed.map((slot) => slot.batchId).filter((id): id is string => id !== null))];
  for (const batchId of batchIds) {
    const batch = await readBatch(supabase, userId, batchId);
    if (!batch.ok) return { ok: false, error: batch.error };
    const inBatch = removed.filter((slot) => slot.batchId === batchId);
    let budget = inBatch.reduce((sum, slot) => sum + slot.chargedTokens, 0);
    let withheld = 0;
    for (const free of planBatchClawback(batch.slots)) {
      const take = Math.min(free.discountTokens, budget);
      if (take <= 0) break;
      const { data, error } = await supabase
        .from('scheduled_posts')
        .update({ charged_tokens: free.chargedTokens + take, discount_tokens: free.discountTokens - take })
        .eq('id', free.id)
        .eq('user_id', userId)
        .eq('discount_tokens', free.discountTokens)
        .eq('charged_tokens', free.chargedTokens)
        .select('id');
      if (error) {
        logger.error('[api/schedule] batch clawback update failed', error, { userId, batchId, slotId: free.id });
        return { ok: false, error };
      }
      // Zero rows: a concurrent cancel already moved this discount back.
      if ((data ?? []).length === 1) {
        withheld += take;
        budget -= take;
      }
    }
    for (const slot of inBatch) {
      const take = Math.min(withheld, slot.chargedTokens);
      refundBySlot.set(slot.id, slot.chargedTokens - take);
      withheld -= take;
    }
  }
  return { ok: true, refundBySlot };
}
