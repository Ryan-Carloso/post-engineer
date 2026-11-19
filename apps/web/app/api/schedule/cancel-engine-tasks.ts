import { logger } from '@/lib/logger';
import { cancelEngineTask, ENGINE_CANCEL_BUDGET_MS } from '@/lib/engine-tasks';
import type { ScheduleCancelSlot } from './cancel-slots';

export async function cancelRemovedEngineTasks(
  removed: ScheduleCancelSlot[],
  scheduleId: string,
  userId: string,
): Promise<void> {
  const cancellableTasks: { slotId: string; taskId: string }[] = [];
  for (const slot of removed) {
    if (slot.taskId === null || slot.status === 'ready') continue;
    cancellableTasks.push({ slotId: slot.id, taskId: slot.taskId });
  }
  if (cancellableTasks.length === 0) return;
  const cancelPromises = cancellableTasks.map(({ slotId, taskId }) =>
    cancelEngineTask(taskId, userId).catch((error: unknown) => {
      logger.error('[api/schedule] engine cancel failed', error, {
        scheduleId,
        slotId,
        userId,
      });
    }),
  );
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled(cancelPromises),
      new Promise<void>((resolve) => {
        budgetTimer = setTimeout(resolve, ENGINE_CANCEL_BUDGET_MS);
      }),
    ]);
  } finally {
    clearTimeout(budgetTimer);
  }
}
