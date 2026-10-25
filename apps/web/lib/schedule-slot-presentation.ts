import { fetchEngineTaskProgress, type EngineTaskProgress } from './engine-tasks';
import { isRetryableGenerationError } from './generation/generation-errors';
import { resolveGoneGenerationId } from './generation/gone-generation-reconcile';
import { settleGoneGeneration, type GoneSettleOutcome } from './generation/gone-settle';
import { createSupabaseServiceClient } from './supabase/service';
import { logger } from './logger';

//---------------
// Schedule slot presentation — the shared contract for presenting a
// scheduled_posts row to clients, used by both GET /api/schedule/status
// (lists) and GET /api/schedule/slots/[slotId] (detail). The DB keeps the
// 'pending' string; the API presents it as the friendlier 'awaiting'.
// progress/stage come from the live engine task for generating slots,
// fetched read-only via the shared engine-tasks helper. A failed lookup
// degrades (progress 0, stage null) instead of failing the request.
//
// ONE deliberate exception to "read-only": an engine 404 (the engine forgot
// the task) is TERMINAL. This endpoint is what the UI polls while a video
// renders, so a task the engine dropped would otherwise be re-polled
// forever and its history row would sit in `running` indefinitely. On a 404
// the slot is settled as failed once, here — the same terminal transition
// the per-task video-status route performs. Everything else stays read-only.
//---------------

export interface SlotEnrichment {
  status: string;
  progress: number;
  stage: string | null;
  queuePosition: number | null;
  queueTotal: number | null;
  // Stable user-warning codes the engine recorded on the slot's task (see
  // warningsFromTask). Only consulted when the slot's engine task was
  // actually read; [] otherwise, so surfaces that skipped the lookup stay
  // silent instead of asserting a warning they did not see.
  warnings: string[];
  retryable: boolean | null;
}

export type QueuePositions = Map<string, Map<string, { position: number; total: number }>>;

export function presentStatus(dbStatus: string): string {
  return dbStatus === 'pending' ? 'awaiting' : dbStatus;
}

//---------------
// GONE_TASK_ERROR — the message stored on a slot whose engine task the
// engine dropped. It carries the `engine_restart` code so the retryability
// check classifies it like any other engine-restart failure.
//---------------
const GONE_TASK_ERROR = 'engine_restart: the video task no longer exists on the generation engine';

//---------------
// settleGoneTask — record the terminal state for a task the engine no
// longer serves, VERIFIED against the durable state row first.
//
// The engine's HTTP answer alone is not trusted: production showed 404s for
// tasks the persisted engine_task_state row says completed (and published)
// — the previous quiet `failed` verdict was wrong for delivered videos
// (see apps/web/lib/generation/gone-settle.ts). The durable verification
// lives there; this wrapper resolves the owning generation and only fails
// the history row after every proof of delivery came up empty.
//
// NO REFUND happens here. The per-generation refund RPC keys on a charge
// row this path cannot prove exists (batch posts are prepaid under the
// batch id and refunded by the engine's own batch runner), so this only
// advances the history row. Tokens for a dropped scheduled post are
// settled by the billing reconciliation cron, which owns that decision.
//
// Failures are logged, never thrown: a status read must not 500 because a
// history write could not land — the next poll retries.
//---------------
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
      // The prepaid batch charge names the whole batch; one slot's task
      // verdict must never stamp it (billing/history belongs to the slot
      // rows, batch:...:slot:..., settled through their own tasks).
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
      // Left deliberately non-terminal: the durable lookup or the
      // published-slot check could not be performed. The next status poll
      // retries; the daily billing reconcile is the eventual backstop.
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

//---------------
// settledCompletedForTask — the video_generations row a failed slot's task
// belongs to can already read `completed` (a durable-state backfill — e.g.
// PR #281's gone-settle — ran on an earlier poll while the slot row itself
// still reads `failed`). Presenting that as retryable would offer a retry
// for a delivered video; this read settles the presentation in one query.
// Only called for slots that already read a terminal-failed status, so the
// fan-out cost is bounded by the failed-slot count, not by the schedule.
//---------------
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
    return null; // unknown: the caller keeps the existing presentation
  }
  const rows = Array.isArray(data) ? data : [];
  return rows.some((row) => (row as { status?: unknown }).status === 'completed');
}

export async function enrichSlot(
  slot: { status?: unknown; task_id?: unknown; error?: unknown; schedule_id?: unknown; id?: unknown },
  userId: string,
  queuePositions: QueuePositions = new Map(),
  options: { allowEngineLookup?: boolean; task?: EngineTaskProgress } = {},
): Promise<SlotEnrichment> {
  const dbStatus = typeof slot.status === 'string' ? slot.status : 'pending';
  const enrichment: SlotEnrichment = {
    status: presentStatus(dbStatus),
    progress: 0,
    stage: null,
    queuePosition: null,
    queueTotal: null,
    retryable: null,
    warnings: [],
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
      // A failed slot whose generation row was backfilled completed (a
      // durable-state backfill ran on an earlier poll) is DONE WORK: it is
      // presented completed and can never be flagged retryable — the tail
      // below only fills retryable when this leaves it null. FAIL-CLOSED is
      // not applicable: an unknown status keeps the failed presentation.
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
      // allowEngineLookup false degrades past the fan-out cap (progress 0).
      // A prefetched task (options.task) is used as-is: the caller already
      // paid for the read and needs other fields from the same record.
      if (taskId && options.allowEngineLookup !== false) {
        try {
          const task = options.task ?? (await fetchEngineTaskProgress(taskId, userId));
          if (task.gone) {
            // The engine no longer serves this task. The durable state row
            // decides the verdict (completed videos must not be failed):
            // a completed backfill is never retryable (false, not null: the
            // failed-slot tail below refills a null retryable), a failed
            // settle is, and an unresolved one presents failed without a
            // retry offer until verification lands.
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
            enrichment.warnings = task.warnings;
          }
        } catch (error) {
          // Transient (5xx, abort, network): degrade, keep the slot as-is so
          // the next poll retries. Only a 404 is terminal.
          logger.warn('[api/schedule] engine task progress unavailable', {
            taskId,
            error: error instanceof Error ? error.message : String(error),
          });
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
    case 'published': {
      enrichment.progress = 100;
      enrichment.stage = 'done';
      const readyTaskId = typeof slot.task_id === 'string' ? slot.task_id : null;
      if (readyTaskId && options.allowEngineLookup !== false) {
        try {
          const task = options.task ?? (await fetchEngineTaskProgress(readyTaskId, userId));
          if (Array.isArray(task.warnings) && task.warnings.length > 0) {
            enrichment.warnings = task.warnings;
          }
        } catch (error) {
          logger.warn('[api/schedule] engine task progress unavailable', {
            taskId: readyTaskId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } else if (Array.isArray(options.task?.warnings) && options.task.warnings.length > 0) {
        enrichment.warnings = options.task.warnings;
      }
      return enrichment;
    }
    default:
      return enrichment;
  }
}
