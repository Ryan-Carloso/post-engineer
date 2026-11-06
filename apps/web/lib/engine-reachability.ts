import { EngineTaskLookupError } from './engine-tasks';
import { logger } from './logger';

//---------------
// Engine reachability probe — one per list request. When one engine task
// progress lookup fails because the engine cannot be reached (network
// error, abort/timeout, 502/503/504), the engine is treated as unreachable
// for the rest of that request: the remaining lookups are skipped (their
// slots degrade to progress 0, exactly as a failed lookup does) and ONE
// warning is logged instead of one per slot. Other failures (a 500 for one
// task, a config error) are tied to that lookup and never trip the probe;
// a 404 is not a throw at all (the task is reported gone).
//---------------

const UNREACHABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

export function isEngineUnreachableError(error: unknown): boolean {
  if (error instanceof EngineTaskLookupError) return UNREACHABLE_STATUSES.has(error.status);
  // Transport-level failures thrown by fetch: TypeError for network errors,
  // AbortError for the lookup timeout. The name is read structurally: the
  // AbortError is a DOMException, which is not an Error subclass everywhere.
  if (typeof error !== 'object' || error === null || !('name' in error)) return false;
  return error.name === 'TypeError' || error.name === 'AbortError';
}

export interface EngineProbe {
  /** True once a lookup in this request failed: skip further lookups. */
  readonly unreachable: boolean;
  /** Record a failed lookup. Logs the first failure only. */
  markUnreachable: (taskId: string, error: unknown) => void;
}

export function createEngineProbe(): EngineProbe {
  let unreachable = false;
  return {
    get unreachable(): boolean {
      return unreachable;
    },
    markUnreachable(taskId: string, error: unknown): void {
      if (unreachable) return;
      unreachable = true;
      logger.warn('[api/schedule] engine unreachable, skipping remaining task progress lookups', {
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  };
}
