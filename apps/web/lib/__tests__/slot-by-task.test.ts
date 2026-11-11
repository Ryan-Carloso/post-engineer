import { describe, expect, it, vi } from 'vitest';
import { lookupSlotIdForTask } from '../slot-by-task';

vi.mock('../logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

function mockClient(row: unknown | null, error: unknown = null) {
  const maybeSingle = vi.fn(async () => ({ data: row, error }));
  const eq2 = vi.fn(() => ({ maybeSingle }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  const from = vi.fn(() => ({ select }));
  return { from, select, eq1, eq2, maybeSingle };
}

describe('lookupSlotIdForTask', () => {
  it('returns the slot id for the caller’s task', async () => {
    const client = mockClient({ id: 'slot-1' });
    const slotId = await lookupSlotIdForTask(client as never, 'user-1', 'task-1');
    expect(slotId).toBe('slot-1');
    expect(client.eq1).toHaveBeenCalledWith('user_id', 'user-1');
    expect(client.eq2).toHaveBeenCalledWith('task_id', 'task-1');
  });

  it('returns null when the task has no slot', async () => {
    const client = mockClient(null);
    await expect(lookupSlotIdForTask(client as never, 'user-1', 'task-1')).resolves.toBeNull();
  });

  it('returns null and logs when the lookup fails', async () => {
    const { logger } = await import('../logger');
    const client = mockClient(null, new Error('db down'));
    await expect(lookupSlotIdForTask(client as never, 'user-1', 'task-1')).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      '[slot-by-task] slot lookup failed',
      expect.objectContaining({ taskId: 'task-1' }),
    );
  });
});
