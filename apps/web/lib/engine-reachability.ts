import { EngineTaskLookupError } from './engine-tasks';
import { logger } from './logger';

const UNREACHABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

export function isEngineUnreachableError(error: unknown): boolean {
  if (error instanceof EngineTaskLookupError) return UNREACHABLE_STATUSES.has(error.status);
  if (typeof error !== 'object' || error === null || !('name' in error)) return false;
  return error.name === 'TypeError' || error.name === 'AbortError';
}

export interface EngineProbe {
  readonly unreachable: boolean;
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
