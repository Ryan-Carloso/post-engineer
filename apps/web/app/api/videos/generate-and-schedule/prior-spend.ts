import type { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { trackApiEvent } from '@/lib/analytics';
import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { logger } from '@/lib/logger';
import { netLedgerSpent } from '@/lib/tokens';

import { coded } from './prepare-persona';

export const SPEND_LEDGER_TYPES = ['video_generation', 'generation_refund'] as const;

export interface SpendLedgerRow {
  type: unknown;
  amount: unknown;
  reference_id: unknown;
}

export function isRollbackRefund(row: SpendLedgerRow, generationId: string): boolean {
  return (
    row.type === 'generation_refund' &&
    typeof row.reference_id === 'string' &&
    row.reference_id.startsWith(`${generationId}:rollback:`)
  );
}

export function hasSlotRefund(rows: SpendLedgerRow[], generationId: string): boolean {
  return rows.some((row) => row.type === 'generation_refund' && !isRollbackRefund(row, generationId));
}

export async function resolvePriorSpend(
  supabase: SupabaseClient,
  input: { userId: string; scheduleId: string; generationId: string; scheduleWasLive: boolean },
): Promise<{ alreadySpent: boolean } | NextResponse> {
  const { userId, scheduleId, generationId } = input;
  const internalError = (): NextResponse =>
    coded(500, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
  const { data, error } = await supabase
    .from('token_transactions')
    .select('type, amount, reference_id')
    .eq('generation_id', generationId)
    .eq('user_id', userId)
    .in('type', [...SPEND_LEDGER_TYPES]);
  if (error !== null) {
    logger.error('[generate-and-schedule] spend ledger lookup failed', error, { generationId, userId });
    return internalError();
  }
  const rows: SpendLedgerRow[] = data ?? [];
  if (!input.scheduleWasLive && rows.length > 0) {
    let consumed = hasSlotRefund(rows, generationId);
    if (!consumed) {
      const { count, error: slotError } = await supabase
        .from('scheduled_posts')
        .select('id', { count: 'exact', head: true })
        .eq('schedule_id', scheduleId)
        .eq('user_id', userId);
      if (slotError !== null) {
        logger.error('[generate-and-schedule] orphan slot lookup failed', slotError, { scheduleId, userId });
        return internalError();
      }
      consumed = (count ?? 0) > 0;
    }
    if (consumed) {
      logger.warn('[generate-and-schedule] idempotency key belongs to a deleted schedule; refusing to dispatch', {
        scheduleId,
        generationId,
        userId,
      });
      trackApiEvent('video_creation_failed', {
        userId,
        scheduleId,
        errorCode: ERROR_CODES.IDEMPOTENCY_KEY_CONSUMED,
        failureStage: 'idempotency',
      });
      return coded(
        409,
        ERROR_CODES.IDEMPOTENCY_KEY_CONSUMED,
        formatErrorMessage(ERROR_CODES.IDEMPOTENCY_KEY_CONSUMED),
      );
    }
  }
  const alreadySpent = netLedgerSpent(rows) > 0;
  if (alreadySpent) {
    logger.warn('[generate-and-schedule] spend ledger already has this generation_id; resuming without charging', {
      generationId,
      userId,
    });
  }
  return { alreadySpent };
}
