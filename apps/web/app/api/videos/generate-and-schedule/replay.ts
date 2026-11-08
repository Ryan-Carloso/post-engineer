//---------------
// Replay helper for POST /api/videos/generate-and-schedule: fetch an
// existing schedule + slots for an idempotent retry. Extracted from
// route.ts so the route stays under the file-size ratchet.
//---------------

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { logger } from '@/lib/logger';

export async function fetchReplay(
  supabase: SupabaseClient,
  userId: string,
  scheduleId: string,
  voiceFallbackWarning: { code: string; fromVoice: string; toVoice: string } | null = null,
): Promise<NextResponse | null> {
  const { data: slots, error } = await supabase
    .from('scheduled_posts')
    .select('id, slot_at, title, task_id, status')
    .eq('schedule_id', scheduleId)
    .eq('user_id', userId)
    .order('slot_at', { ascending: true });
  if (error || !slots) {
    logger.error('[generate-and-schedule] replay fetch failed', error, { scheduleId });
    return null;
  }
  // Replay ASAP uses the stored publish_mode; pre-015 rows default scheduled.
  const { data: scheduleRow } = await supabase
    .from('schedules')
    .select('publish_mode')
    .eq('id', scheduleId)
    .eq('user_id', userId)
    .maybeSingle();
  const mode =
    (scheduleRow as { publish_mode?: unknown } | null)?.publish_mode === 'asap' ? 'asap' : 'scheduled';
  return NextResponse.json({
    success: true,
    schedule: { id: scheduleId, mode },
    slots: slots.map((row) => ({
      slotId: (row as { id: string }).id,
      slotAt: (row as { slot_at: string }).slot_at,
      title: (row as { title: string }).title,
      taskId: (row as { task_id: string | null }).task_id,
      status: (row as { status: string }).status,
    })),
    replayed: true,
    ...(voiceFallbackWarning !== null ? { warnings: [voiceFallbackWarning] } : {}),
  });
}
