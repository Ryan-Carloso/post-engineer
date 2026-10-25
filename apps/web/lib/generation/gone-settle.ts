import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';
import { recordGenerationUpdate } from './video-generation';

//---------------
// gone-settle — the terminal verdict for an engine task the HTTP layer
// reports as gone (GET /tasks/<id> → 404).
//
// WHY THIS EXISTS: production evidence (2026-10) showed the engine answering
// 404 for tasks whose persisted `engine_task_state` row was COMPLETE with a
// finished video — an infra blip (engine redeploy window / edge proxy) that
// the HTTP status alone cannot distinguish from a genuinely lost task. The
// old callers treated any 404 as "engine restarted while generating" and
// wrote `failed` + `engine_restart` onto the video_generations row — for
// videos that had actually finished and even been published.
//
// The durable state row (written by the Supabase state backend at pipeline
// completion) is the tie-breaker:
//
// 1. `engine_task_state.state = 1` (COMPLETE) with a finished video → the
//    video exists: backfill `completed`, never refund.
// 2. A published slot for the same task → value delivered: backfill
//    `completed` (mirrors the billing reconciler's value-delivered rule).
// 3. No durable row and no published slot → the task really died mid-flight:
//    write `failed` with `engine_restart` exactly as before.
//
// A read error is deliberately NOT a failure: the caller leaves the history
// row untouched so the retry (next poll / billing reconcile) settles it
// later. Writing `failed` on an unverifiable state cannot be undone for the
// user-facing card and would also suppress the reconcile's completed
// backfill (terminal rows are excluded from find_stuck_generations).
//---------------

export type GoneSettleOutcome = 'completed' | 'failed' | 'unresolved';

//---------------
// readDurableTaskState — the persisted truth for one task.
//
// ok:false means the check could not be performed (row absent or query
// error); ok:true carries the numeric state (-1 failed, 1 complete) and
// whether a finished video was persisted alongside it. `data->videos` is
// what the engine writes at completion (task.py _complete_task), so it is
// the "the render actually finished" signal, not just a state number.
// `user_id` is filtered as well: one user's task row must never settle
// another user's generation.
//---------------
export interface DurableTaskRead {
  ok: boolean;
  complete: boolean;
  hasVideos: boolean;
}

export async function readDurableTaskState(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
): Promise<DurableTaskRead> {
  const { data, error } = await supabase
    .from('engine_task_state')
    .select('state, data')
    .eq('user_id', userId)
    .eq('task_id', taskId)
    .limit(1)
    .maybeSingle();
  if (error || data === null) {
    if (error) {
      // A query error is an unknown state, never "the task died".
      logger.error('[gone-settle] durable task-state lookup failed', error, { taskId });
    }
    return { ok: false, complete: false, hasVideos: false };
  }
  const record = data as { state?: unknown; data?: unknown };
  return {
    ok: true,
    complete: record.state === 1,
    hasVideos: hasPersistedVideos(record.data),
  };
}

function hasPersistedVideos(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const videos = (data as Record<string, unknown>).videos;
  return Array.isArray(videos) && videos.length > 0;
}

//---------------
// hasPublishedSlotForTask — value-delivered proof, same rule the billing
// reconciler applies (billing/reconcile.ts): a published slot for this task
// means the video reached the network even if the engine task is gone.
// Exported: the video-status 404 path must apply the SAME verdict as the
// slot-gone path before it may fail (and refund) a generation.
//---------------
export async function hasPublishedSlotForTask(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
): Promise<boolean | null> {
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('id')
    .eq('user_id', userId)
    .eq('task_id', taskId)
    .eq('status', 'published')
    .limit(1);
  if (error) {
    logger.error('[gone-settle] published-slot lookup failed', error, { taskId });
    return null;
  }
  return (data?.length ?? 0) > 0;
}

//---------------
// settleGoneGeneration — resolve + settle one gone task's history row.
//
// The caller must already have resolved `generationId` (the video_generations
// row that names this task); a row the resolution cannot name is untouched,
// as before. Returns what was written so the caller can decide the UI's
// retry affordance (a completed video is not retryable).
//---------------
export async function settleGoneGeneration(input: {
  supabase: SupabaseClient;
  userId: string;
  taskId: string;
  generationId: string;
}): Promise<GoneSettleOutcome> {
  const { supabase, userId, taskId, generationId } = input;
  // NOTE: the batch-billing-key refusal lives in the caller (see
  // resolveGoneGenerationId's batchChargeKey flag): a settle path receives
  // only ids that name THIS generation. Re-checking shapes here would also
  // block a legitimately-batch-keyed video_generations row found by engine_task_id.


  // Durable state first: it outranks any live-HTTP answer, including the
  // 404 that brought us here. A persisted COMPLETE with a render output is
  // finished work regardless of what the process currently serves.
  const durable = await readDurableTaskState(supabase, userId, taskId);
  if (durable.complete && durable.hasVideos) {
    await recordGenerationUpdate({
      supabase,
      generationId,
      status: 'completed',
      engineTaskId: taskId,
    });
    logger.info('[gone-settle] durable task is complete; history row backfilled completed', {
      taskId,
    });
    return 'completed';
  }

  // No persisted completion. Delivered value still counts: a slot the
  // publisher marked published means the render finished even when the
  // state row is absent. Read errors leave the row alone (fail closed
  // against false failures) so the next poll or the daily reconcile retries.
  const published = await hasPublishedSlotForTask(supabase, userId, taskId);
  if (published === true) {
    await recordGenerationUpdate({
      supabase,
      generationId,
      status: 'completed',
      engineTaskId: taskId,
    });
    logger.info('[gone-settle] published slot proves delivery; history row completed', {
      taskId,
    });
    return 'completed';
  }
  if (published === null) {
    return 'unresolved';
  }

  // Genuinely dead work: the engine holds no task, no persisted completion,
  // and nothing was published. The historical verdict stands.
  await recordGenerationUpdate({
    supabase,
    generationId,
    status: 'failed',
    engineTaskId: taskId,
    errorCode: 'engine_restart',
    errorMessage: 'engine_restart: the video task no longer exists on the generation engine',
  });
  return 'failed';
}
