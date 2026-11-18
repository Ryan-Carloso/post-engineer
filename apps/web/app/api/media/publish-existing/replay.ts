import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { apiErrorResponse } from '@/lib/api-error';
import type { AccountNeedsReconnectWarning } from '@/lib/account-needs-reconnect';
import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { logger } from '@/lib/logger';

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

function warningFields(
  warning: AccountNeedsReconnectWarning | null,
): { warnings?: AccountNeedsReconnectWarning[] } {
  return warning === null ? {} : { warnings: [warning] };
}

export async function replaySchedule(
  supabase: SupabaseClient,
  scheduleId: string,
  userId: string,
  route: string,
  reconnectWarning: AccountNeedsReconnectWarning | null = null,
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
    ...warningFields(reconnectWarning),
  });
}
