import { fetchEngineTaskProgress, type EngineTaskProgress } from './engine-tasks';
import { isEngineUnreachableError, type EngineProbe } from './engine-reachability';
import { isRetryableGenerationError } from './generation/generation-errors';
import { resolveGoneGenerationId } from './generation/gone-generation-reconcile';
import { settleGoneGeneration, type GoneSettleOutcome } from './generation/gone-settle';
import { createSupabaseServiceClient } from './supabase/service';
import { logger } from './logger';

export interface SlotEnrichment {
  status: string;
  progress: number;
  stage: string | null;
  queuePosition: number | null;
  queueTotal: number | null;
  retryable: boolean | null;
}

export type QueuePositions = Map<string, Map<string, { position: number; total: number }>>;

export function presentStatus(dbStatus: string): string {
  return dbStatus === 'pending' ? 'awaiting' : dbStatus;
}

const GONE_TASK_ERROR = 'engine_restart: the video task no longer exists on the generation engine';

async function settleGoneTask(taskId: string, userId: string): Promise<GoneSettleOutcome> {
  try {
    const supabase = createSupabaseServiceClient();
    const resolution = await resolveGoneGenerationId(supabase, userId, taskId);
    if (!resolution) {
      logger.warn('[api/schedule] gone task has no resolvable generation; history row left untouched', {
        taskId,
      });
      return 'unresolved';
    }
    if (resolution.batchChargeKey) {
      logger.warn('[api/schedule] gone task resolved to the batch charge key; history left untouched', {
        taskId,
      });
      return 'unresolved';
    }
    const outcome = await settleGoneGeneration({
      supabase,
      userId,
      taskId,
      generationId: resolution.generationId,
    });
    if (outcome === 'unresolved') {
      logger.warn('[api/schedule] gone task unverifiable; history row left untouched', {
        taskId,
      });
    }
    return outcome;
  } catch (error) {
    logger.error('[api/schedule] failed to settle a gone engine task', {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'unresolved';
  }
}

async function settledCompletedForTask(
  taskId: string,
  userId: string,
  supabase: ReturnType<typeof createSupabaseServiceClient>,
): Promise<boolean | null> {
  const { data, error } = await supabase
    .from('video_generations')
    .select('status')
    .eq('user_id', userId)
    .eq('engine_task_id', taskId)
    .limit(1);
  if (error) {
    logger.warn('[api/schedule] generation-status lookup failed', {
      taskId,
      error: error.message,
    });
    return null;
  }
  const rows = Array.isArray(data) ? data : [];
  return rows.some((row) => (row as { status?: unknown }).status === 'completed');
}

export async function enrichSlot(
  slot: { status?: unknown; task_id?: unknown; error?: unknown; schedule_id?: unknown; id?: unknown },
  userId: string,
  queuePositions: QueuePositions = new Map(),
  options: { allowEngineLookup?: boolean; task?: EngineTaskProgress; engineProbe?: EngineProbe } = {},
): Promise<SlotEnrichment> {
  const dbStatus = typeof slot.status === 'string' ? slot.status : 'pending';
  const enrichment: SlotEnrichment = {
    status: presentStatus(dbStatus),
    progress: 0,
    stage: null,
    queuePosition: null,
    queueTotal: null,
    retryable: null,
  };
  switch (dbStatus) {
    case 'pending': {
      const scheduleId = typeof slot.schedule_id === 'string' ? slot.schedule_id : null;
      const id = typeof slot.id === 'string' ? slot.id : null;
      const queue = scheduleId && id ? queuePositions.get(scheduleId)?.get(id) : undefined;
      enrichment.queuePosition = queue?.position ?? null;
      enrichment.queueTotal = queue?.total ?? null;
      return enrichment;
    }
    case 'generating':
    case 'failed': {
      const taskId = typeof slot.task_id === 'string' ? slot.task_id : null;
      if (dbStatus === 'failed' && taskId) {
        try {
          const completed = await settledCompletedForTask(
            taskId,
            userId,
            createSupabaseServiceClient(),
          );
          if (completed === true) {
            enrichment.status = 'completed';
            enrichment.progress = 100;
            enrichment.retryable = false;
            return enrichment;
          }
        } catch (statusError) {
          logger.warn('[api/schedule] settled-status check failed', {
            taskId,
            error: statusError instanceof Error ? statusError.message : String(statusError),
          });
        }
      }
      const engineDown = options.engineProbe?.unreachable === true && options.task === undefined;
      if (taskId && options.allowEngineLookup !== false && !engineDown) {
        try {
          const task = options.task ?? (await fetchEngineTaskProgress(taskId, userId));
          if (task.gone) {
            const outcome = await settleGoneTask(taskId, userId);
            if (outcome === 'completed') {
              enrichment.status = 'completed';
              enrichment.progress = 100;
              enrichment.retryable = false;
            } else {
              enrichment.status = 'failed';
              enrichment.retryable =
                outcome === 'failed'
                  ? isRetryableGenerationError(GONE_TASK_ERROR)
                  : false;
            }
          } else {
            enrichment.progress = task.progress;
            if (dbStatus === 'generating') enrichment.stage = task.stage;
          }
        } catch (error) {
          if (options.engineProbe !== undefined && isEngineUnreachableError(error)) {
            options.engineProbe.markUnreachable(taskId, error);
          } else {
            logger.warn('[api/schedule] engine task progress unavailable', {
              taskId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
      if (dbStatus === 'failed' && enrichment.retryable === null) {
        enrichment.retryable = isRetryableGenerationError(
          typeof slot.error === 'string' ? slot.error : null,
        );
      }
      return enrichment;
    }
    case 'ready':
    case 'publishing':
    case 'published':
      enrichment.progress = 100;
      enrichment.stage = 'done';
      return enrichment;
    default:
      return enrichment;
  }
}
