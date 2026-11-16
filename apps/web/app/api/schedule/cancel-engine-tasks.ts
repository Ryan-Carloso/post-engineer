import { logger } from '@/lib/logger';
import { cancelEngineTask, ENGINE_CANCEL_BUDGET_MS } from '@/lib/engine-tasks';
import type { ScheduleCancelSlot } from './cancel-slots';

//---------------
// cancelRemovedEngineTasks — engine DELETE for every removed slot whose
// generation may still be running (issue #447).
//
// A removed slot whose generation already ran may still be consuming
// engine compute. Signal the engine to stop that worker at its next stage
// boundary — before the refunds — so a cancelled slot never finishes (and
// never publishes). A `ready` task is already complete, so only slots that
// may still be running are signalled (`generating`, or `pending` that
// already carries a task id). This is best-effort: the refunds must still
// happen when the engine is unreachable (the user must not lose tokens),
// so a failure is logged loudly and the cancel continues — never a bare
// 500 after the slot deletion already committed. The cancels run
// concurrently under an aggregate budget: a hung engine must not delay the
// refunds, so the race proceeds past the budget and the stragglers keep
// their own per-call timeout (ENGINE_CANCEL_TIMEOUT_MS) and still log on
// failure.
//---------------
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
    if (budgetTimer !== undefined) clearTimeout(budgetTimer);
  }
}
