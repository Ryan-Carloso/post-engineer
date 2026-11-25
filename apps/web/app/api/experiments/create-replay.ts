import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { logger } from '@/lib/logger';
import { internalError } from './create-plan';
import type { ExperimentWarning } from './create-plan';

interface ReplayRow {
  id: string;
  slot_at: string;
  title: string;
  task_id: string | null;
  status: string;
  prompt_version_id: string | null;
  charged_tokens: number | null;
}

export function replayResponse(scheduleId: string, rows: ReplayRow[], warnings: ExperimentWarning[]): NextResponse {
  return NextResponse.json({
    success: true,
    stage: 'confirmed',
    scheduleId,
    replayed: true,
    chargedTokens: rows.reduce((sum, row) => sum + (row.charged_tokens ?? 0), 0),
    slots: rows.map((row) => ({
      slotId: row.id,
      slotAt: row.slot_at,
      title: row.title,
      versionId: row.prompt_version_id,
      taskId: row.task_id,
      status: row.status,
    })),
    warnings,
  });
}

export async function fetchReplayRows(
  supabase: SupabaseClient,
  userId: string,
  scheduleId: string,
): Promise<ReplayRow[] | null> {
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('id, slot_at, title, task_id, status, prompt_version_id, charged_tokens')
    .eq('schedule_id', scheduleId)
    .eq('user_id', userId)
    .order('slot_at', { ascending: true });
  if (error || !data) {
    logger.error('[experiments-create] replay fetch failed', error, { scheduleId });
    return null;
  }
  return data as ReplayRow[];
}

export interface ExistingScheduleOutcome {
  live: boolean;
  replay: NextResponse | null;
}

export async function resolveExistingSchedule(
  supabase: SupabaseClient,
  userId: string,
  scheduleId: string,
): Promise<ExistingScheduleOutcome | NextResponse> {
  const { data: existing, error } = await supabase
    .from('schedules')
    .select('id')
    .eq('id', scheduleId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    logger.error('[experiments-create] schedule lookup failed', error, { scheduleId, userId });
    return internalError();
  }
  if (!existing) return { live: false, replay: null };
  const rows = await fetchReplayRows(supabase, userId, scheduleId);
  if (rows === null) return internalError();
  if (rows.length > 0) return { live: true, replay: replayResponse(scheduleId, rows, []) };
  logger.warn('[experiments-create] deleting zombie schedule with 0 slots', { scheduleId, userId });
  await supabase.from('schedules').delete().eq('id', scheduleId).eq('user_id', userId);
  return { live: true, replay: null };
}
