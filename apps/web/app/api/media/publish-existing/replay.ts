//---------------
// Idempotent replay for publish-existing (issue #384): a retried
// scheduled request addresses the same deterministic schedule id, so the
// second attempt answers with the rows the first attempt created instead
// of scheduling a duplicate. A schedule with zero slots is a zombie from
// a crashed first attempt (the slot insert failed after the schedule
// insert) — delete it so the retry can proceed instead of replaying an
// empty schedule.
//---------------

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { logger } from '@/lib/logger';

export interface SlotSummary {
  id: string;
  slot_at: string;
  title: string;
  status: string;
}

export function toSlotSummaries(rows: unknown): SlotSummary[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row) => ({
      id: String(row.id),
      slot_at: String(row.slot_at),
      title: String(row.title),
      status: typeof row.status === 'string' ? row.status : 'ready',
    }));
}

export async function replaySchedule(
  supabase: SupabaseClient,
  scheduleId: string,
  userId: string,
  route: string,
): Promise<NextResponse | null> {
  const { data: existing, error: existingError } = await supabase
    .from('schedules')
    .select('id')
    .eq('id', scheduleId)
    .eq('user_id', userId)
    .maybeSingle();
  if (existingError) {
    logger.error('[publish-existing] idempotency lookup failed', existingError, { scheduleId, userId });
    return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
      route,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
  if (!existing) return null;
  const { data: slots, error: slotsError } = await supabase
    .from('scheduled_posts')
    .select('id, slot_at, title, status')
    .eq('schedule_id', scheduleId)
    .order('slot_at');
  if (slotsError) {
    logger.error('[publish-existing] replay slots lookup failed', slotsError, { scheduleId, userId });
    return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
      route,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
  const summaries = toSlotSummaries(slots);
  if (summaries.length === 0) {
    await supabase.from('schedules').delete().eq('id', scheduleId).eq('user_id', userId);
    return null;
  }
  return NextResponse.json({
    success: true,
    mode: 'scheduled',
    replayed: true,
    schedule: { id: scheduleId },
    slots: summaries,
  });
}
