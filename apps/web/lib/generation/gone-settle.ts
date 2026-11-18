import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';
import { recordGenerationUpdate } from './video-generation';

export type GoneSettleOutcome = 'completed' | 'failed' | 'unresolved';

export interface DurableTaskRead {
  ok: boolean;
  complete: boolean;
  hasVideos: boolean;
  errored: boolean;
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
      logger.error('[gone-settle] durable task-state lookup failed', error, { taskId });
    }
    return { ok: false, complete: false, hasVideos: false, errored: Boolean(error) };
  }
  const record = data as { state?: unknown; data?: unknown };
  return {
    ok: true,
    complete: record.state === 1,
    hasVideos: hasPersistedVideos(record.data),
    errored: false,
  };
}

function hasPersistedVideos(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const videos = (data as Record<string, unknown>).videos;
  return Array.isArray(videos) && videos.length > 0;
}

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

export async function settleGoneGeneration(input: {
  supabase: SupabaseClient;
  userId: string;
  taskId: string;
  generationId: string;
}): Promise<GoneSettleOutcome> {
  const { supabase, userId, taskId, generationId } = input;
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
  if (durable.errored) {
    logger.error(
      '[gone-settle] durable task-state lookup errored; history row left untouched',
      undefined,
      { taskId },
    );
    return 'unresolved';
  }

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
