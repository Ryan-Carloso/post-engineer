import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/engine-tasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/engine-tasks')>();
  return { ...actual, cancelEngineTask: vi.fn() };
});
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { cancelRemovedEngineTasks } from '../cancel-engine-tasks';
import { cancelEngineTask } from '@/lib/engine-tasks';
import type { ScheduleCancelSlot } from '../cancel-slots';

//---------------
// cancelRemovedEngineTasks — which removed slots get an engine cancel.
// Only slots that may still be running are signalled: a slot with no task
// id never reached the engine, and a ready slot's task already finished.
//---------------

function slot(id: string, status: string, taskId: string | null): ScheduleCancelSlot {
  return { id, status, chargedTokens: 2, batchId: null, taskId, mediaKind: null, mediaRef: null };
}

beforeEach(() => {
  vi.mocked(cancelEngineTask).mockReset();
  vi.mocked(cancelEngineTask).mockResolvedValue(undefined);
});

describe('cancelRemovedEngineTasks', () => {
  it('makes no engine call when no removed slot can still be running', async () => {
    await cancelRemovedEngineTasks(
      [slot('a', 'pending', null), slot('b', 'ready', 'task-b')],
      'schedule-1',
      'user-1',
    );
    expect(cancelEngineTask).not.toHaveBeenCalled();
  });

  it('cancels generating slots and pending slots that already carry a task id', async () => {
    await cancelRemovedEngineTasks(
      [slot('a', 'generating', 'task-a'), slot('b', 'pending', 'task-b'), slot('c', 'ready', 'task-c')],
      'schedule-1',
      'user-1',
    );
    expect(vi.mocked(cancelEngineTask).mock.calls).toEqual([
      ['task-a', 'user-1'],
      ['task-b', 'user-1'],
    ]);
  });
});
