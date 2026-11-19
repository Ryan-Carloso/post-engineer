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
  if (!alreadySpent) {
    const refunded = await refundRollbackSpend(supabase, {
      userId,
      generationId,
      amount: perVideoCost,
      reason: 'PK race; refunded redundant spend',
      failureLog: '[generate-and-schedule] PK race refund failed; replaying winner anyway',
    });
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
  logger.error('[generate-and-schedule] PK race replay failed; no further refund', scheduleError, {
    scheduleId,
    userId,
  });
  return coded(500, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
}
