//---------------
// create-from-task — create a one-off schedule for an already-generated
// video task. Used by POST /api/schedule (taskId param) and POST
// /api/persona/video-job (unified generate+schedule).
//
// The slot is created in 'generating' state with the task_id; the engine's
// reconcile loop flips it to 'ready' once the task completes, and the
// publish loop publishes at slot_at. No generation tokens are charged —
// the video was already generated (and charged) separately.
//---------------

import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ScheduleProvider = 'youtube' | 'instagram' | 'linkedin' | 'bluesky';

export interface CreateScheduleFromTaskParams {
  supabase: SupabaseClient;
  userId: string;
  // personaId may be null for faceless videos; the schedule still needs an
  // owner persona for notifications when one exists.
  personaId: string | null;
  providers: ScheduleProvider[];
  youtubeAccountIds: string[];
  instagramAccountIds: string[];
  linkedinAccountIds: string[];
  blueskyAccountIds: string[];
  scheduledAt: Date;
  timezone: string;
  topic: string;
  taskId: string;
}

export interface CreatedSchedule {
  scheduleId: string;
  slotId: string;
  slotAt: string;
}

/**
 * Creates a one-off schedule (kind='batch') with a single slot in
 * 'generating' state linked to an already-generated video task.
 * Throws on DB errors; callers map to HTTP responses.
 */
export async function createScheduleFromTask(
  params: CreateScheduleFromTaskParams,
): Promise<CreatedSchedule> {
  const {
    supabase,
    userId,
    personaId,
    providers,
    youtubeAccountIds,
    instagramAccountIds,
    linkedinAccountIds,
    blueskyAccountIds,
    scheduledAt,
    timezone,
    topic,
    taskId,
  } = params;

  const scheduleId = randomUUID();

  const { data: schedule, error: scheduleError } = await supabase
    .from('schedules')
    .insert({
      id: scheduleId,
      user_id: userId,
      persona_id: personaId,
      // kind='batch': a one-off schedule is a finite prepaid set of slots.
      // See POST /api/schedule for the index rationale.
      kind: 'batch',
      providers,
      youtube_account_ids: youtubeAccountIds,
      instagram_account_ids: instagramAccountIds,
      linkedin_account_ids: linkedinAccountIds,
      bluesky_account_ids: blueskyAccountIds,
      days_of_week: null,
      start_hour: null,
      end_hour: null,
      posts_per_day: 1,
      times: [],
      timezone,
      scheduled_at: scheduledAt.toISOString(),
      active: true,
    })
    .select('id')
    .single();

  if (scheduleError || !schedule) {
    throw new Error(`Failed to create schedule: ${scheduleError?.message ?? 'unknown'}`);
  }

  const { data: slot, error: slotError } = await supabase
    .from('scheduled_posts')
    .insert({
      schedule_id: scheduleId,
      user_id: userId,
      slot_at: scheduledAt.toISOString(),
      // 'generating' with task_id: the engine's reconcile loop flips it to
      // 'ready' once the task completes (it already has, but the loop is
      // the single state machine — no special-casing here).
      status: 'generating',
      task_id: taskId,
      topic,
    })
    .select('id, slot_at')
    .single();

  if (slotError || !slot) {
    // Best-effort rollback: don't leave an orphan schedule.
    await supabase.from('schedules').delete().eq('id', scheduleId).eq('user_id', userId);
    throw new Error(`Failed to create slot: ${slotError?.message ?? 'unknown'}`);
  }

  return {
    scheduleId,
    slotId: String((slot as { id: unknown }).id),
    slotAt: String((slot as { slot_at: unknown }).slot_at),
  };
}
