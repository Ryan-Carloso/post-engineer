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
