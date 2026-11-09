//---------------
// resolveScriptAngle — the angle the engine built the script around, read
// from the engine task record. Cosmetic on the detail page: no task yet or
// a failed lookup degrades to null, but a failure is never silent.
// Extracted from lib/post-detail.ts (file-size ratchet).
//---------------

import { fetchEngineScriptAngle } from './engine-tasks';
import { logger } from './logger';

export async function resolveScriptAngle(taskId: string | null, userId: string): Promise<string | null> {
  if (taskId === null || taskId.length === 0) return null;
  try {
    return await fetchEngineScriptAngle(taskId, userId);
  } catch (error) {
    logger.warn('[post-detail] script angle unavailable', {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
