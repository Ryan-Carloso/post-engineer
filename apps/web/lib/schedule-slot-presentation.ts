import { fetchEngineTaskProgress } from './engine-tasks';
import { isRetryableGenerationError } from './generation/generation-errors';
import { logger } from './logger';

//---------------
// Schedule slot presentation — the shared contract for presenting a
// scheduled_posts row to clients, used by both GET /api/schedule/status
// (lists) and GET /api/schedule/slots/[slotId] (detail). The DB keeps the
// 'pending' string; the API presents it as the friendlier 'awaiting'.
// progress/stage come from the live engine task for generating slots,
// fetched read-only via the shared engine-tasks helper — which, unlike
// the video-status route, performs NO refunds or history writes. A failed
// lookup degrades (progress 0, stage null) instead of failing the request.
//---------------

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

export async function enrichSlot(
  slot: { status?: unknown; task_id?: unknown; error?: unknown; schedule_id?: unknown; id?: unknown },
  userId: string,
  queuePositions: QueuePositions = new Map(),
  options: { allowEngineLookup?: boolean } = {},
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
      // allowEngineLookup false degrades past the fan-out cap (progress 0).
      if (taskId && options.allowEngineLookup !== false) {
        try {
          const task = await fetchEngineTaskProgress(taskId, userId);
          enrichment.progress = task.progress;
          if (dbStatus === 'generating') enrichment.stage = task.stage;
        } catch (error) {
          logger.warn('[api/schedule] engine task progress unavailable', {
            taskId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (dbStatus === 'failed') {
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
