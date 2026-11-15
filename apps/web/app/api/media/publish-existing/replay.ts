//---------------
// Idempotent replay for publish-existing (issue #384): a retried
// scheduled request addresses the same deterministic schedule id, so the
// second attempt answers with the rows the first attempt created instead
// of scheduling a duplicate. A schedule with zero slots is a zombie from
// a crashed first attempt (the slot insert failed after the schedule
// insert) — delete it so the retry can proceed instead of replaying an
// empty schedule. Only a schedule old enough that no live first attempt
// can still be between its two inserts may be deleted: a concurrent
// duplicate with the same idempotency key reads zero slots in that
// window, and deleting the winner's schedule would duplicate the slots
// under one schedule id.
//---------------

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { logger } from '@/lib/logger';

// A first attempt inserts its schedule, then its slots, in two awaits;
// five minutes is far longer than that window can ever be.
const ZOMBIE_SCHEDULE_MIN_AGE_MS = 5 * 60_000;

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
    .select('id, created_at')
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
    const createdAt =
      existing !== null && typeof existing === 'object'
        ? (existing as { created_at?: unknown }).created_at
        : undefined;
    const createdAtMs = typeof createdAt === 'string' ? Date.parse(createdAt) : Number.NaN;
    // A fresh zero-slot schedule may be a live first attempt between its
    // schedule and slot inserts: only a zombie old enough to rule that
    // out is deleted (the delete itself carries the same age predicate,
    // so a row that is fresh at delete time survives). A fresh one is
    // left alone; the retry then hits the schedule insert conflict and
    // retries until the winner's slots exist and replay.
    if (!Number.isNaN(createdAtMs) && Date.now() - createdAtMs >= ZOMBIE_SCHEDULE_MIN_AGE_MS) {
      await supabase
        .from('schedules')
        .delete()
        .eq('id', scheduleId)
        .eq('user_id', userId)
        .lt('created_at', new Date(Date.now() - ZOMBIE_SCHEDULE_MIN_AGE_MS).toISOString());
    }
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
