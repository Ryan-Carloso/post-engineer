import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

//---------------
// refundRollbackSpend — refund a failed generate-and-schedule attempt's
// spend through the net-aware refund_batch_tokens RPC (migration 044), not
// the dashboard-only refund_generation_tokens: after a fully-refunded
// attempt re-charges under the same generation_id the ledger holds two
// spend rows, and a rollback refund capped at the first charge answers
// nothing_to_refund, so the fresh charge is never returned.
//
// The refund key carries a fresh UUID: a retry that re-charges and rolls
// back again must not collide with the first attempt's refund key, or its
// refund answers already_refunded and the fresh charge is never returned.
// Returns true only when the RPC credited the refund. A failed refund is a
// billing discrepancy, not a request failure — it is logged loudly here and
// the caller keeps its own flow. failureLog names the rollback site so the
// log still says which step lost the refund; it defaults to a generic
// message for sites with no dedicated assertion on it.
//---------------
export async function refundRollbackSpend(
  supabase: SupabaseClient,
  input: {
    userId: string;
    generationId: string;
    amount: number;
    reason: string;
    failureLog?: string;
  },
): Promise<boolean> {
  const { data, error } = await supabase.rpc('refund_batch_tokens', {
    p_user_id: input.userId,
    p_batch_generation_id: input.generationId,
    p_refund_key: `${input.generationId}:rollback:${randomUUID()}`,
    p_amount: input.amount,
    p_reason: input.reason,
  });
  const refunded =
    error === null && (data as { refunded?: unknown } | null)?.refunded === true;
  if (!refunded) {
    logger.error(
      input.failureLog ?? '[generate-and-schedule] rollback refund failed',
      error ?? undefined,
      { userId: input.userId, generationId: input.generationId },
    );
  }
  return refunded;
}
