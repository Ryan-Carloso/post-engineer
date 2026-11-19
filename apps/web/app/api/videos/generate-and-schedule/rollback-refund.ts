import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

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
