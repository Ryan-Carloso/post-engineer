//---------------
// Schedule primary-key race handler for POST /api/videos/generate-and-schedule.
// Extracted from route.ts so the route stays under the file-size ratchet.
// The handler always returns: it replays the winner's schedule or answers a
// retryable 500. It never falls through to the generic insert-failure refund,
// which would refund the winner's charge a second time.
//---------------

import type { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { trackApiEvent } from '@/lib/analytics';
import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { logger } from '@/lib/logger';

import { coded } from './prepare-persona';
import { fetchReplay } from './replay';
import { refundRollbackSpend } from './rollback-refund';
import { type ScheduleWarning } from './schedule-warnings';

export async function answerSchedulePkRace(
  supabase: SupabaseClient,
  input: {
    userId: string;
    scheduleId: string;
    generationId: string;
    perVideoCost: number;
    alreadySpent: boolean;
    scheduleError: unknown;
    constraint: string;
    warnings: ScheduleWarning[];
  },
): Promise<NextResponse> {
  const { userId, scheduleId, generationId, perVideoCost, alreadySpent, scheduleError, constraint } = input;
  // Lost a PK race with a concurrent duplicate (or a replay slipped past
  // the pre-check) on schedules_pkey. If we spent in this request, our
  // spend is redundant: the winner's own spend under the same
  // generation_id is the single charge, so undo ours. Without this, the
  // missing unique constraint on token_transactions.generation_id lets
  // both spends stand.
  // When we skipped our spend (alreadySpent), there is nothing of ours
  // to undo — refunding would steal the legitimate prior spend.
  if (!alreadySpent) {
    const refunded = await refundRollbackSpend(supabase, {
      userId,
      generationId,
      amount: perVideoCost,
      reason: 'PK race; refunded redundant spend',
      failureLog: '[generate-and-schedule] PK race refund failed; replaying winner anyway',
    });
    // The winner's schedule exists regardless of whether our refund
    // landed: still replay it below. A failed refund is a billing
    // discrepancy, not a request failure — the helper logs it loudly
    // for investigation instead of letting the log claim success.
    if (refunded) {
      logger.error('[generate-and-schedule] schedule PK race; refunded redundant spend, replaying winner', scheduleError, {
        scheduleId,
        userId,
        constraint,
      });
    }
  } else {
    logger.error('[generate-and-schedule] schedule PK race; already spent, nothing to refund, replaying winner', scheduleError, {
      scheduleId,
      userId,
      constraint,
    });
  }
  trackApiEvent('video_creation_failed', {
    userId,
    scheduleId,
    errorCode: 'IDEMPOTENCY_CONFLICT',
    failureStage: 'schedule_insert_race',
  });
  const replayed = await fetchReplay(supabase, userId, scheduleId, input.warnings);
  if (replayed) return replayed;
  // The winner's schedule exists but could not be read back. Never fall
  // through to the generic insert-failure refund: that refund would return
  // the winner's charge (our own spend was already refunded above) or, when
  // alreadySpent, the legitimate prior spend. A retry with the same
  // idempotency key replays through the pre-check.
  logger.error('[generate-and-schedule] PK race replay failed; no further refund', scheduleError, {
    scheduleId,
    userId,
  });
  return coded(500, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
}
