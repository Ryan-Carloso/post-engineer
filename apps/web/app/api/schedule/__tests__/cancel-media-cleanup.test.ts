// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { logger } from '@/lib/logger';
import { removeCancelledMediaImages } from '../cancel-media-cleanup';
import type { ScheduleCancelSlot } from '../cancel-slots';

function slot(overrides: Partial<ScheduleCancelSlot>): ScheduleCancelSlot {
  return {
    id: 'slot-1',
    status: 'ready',
    chargedTokens: 0,
    batchId: null,
    taskId: null,
    mediaKind: null,
    mediaRef: null,
    ...overrides,
  };
}

function fakeServiceClient(remove: ReturnType<typeof vi.fn>) {
  return {
    storage: { from: vi.fn(() => ({ remove })) },
  } as never;
}

describe('removeCancelledMediaImages', () => {
  it('removes only the stored images of cancelled slots', async () => {
    const remove = vi.fn(async () => ({ error: null }));
    const client = fakeServiceClient(remove);
    await removeCancelledMediaImages(
      client,
      [
        slot({ id: 's1', mediaKind: 'image', mediaRef: 'scheduled-media/user-1/a.jpg' }),
        slot({ id: 's2', mediaKind: 'image', mediaRef: 'scheduled-media/user-1/b.png' }),
        slot({ id: 's3', mediaKind: 'upload', mediaRef: 'upload-id-1' }),
        slot({ id: 's4', taskId: 'task-1' }),
        slot({ id: 's5', mediaKind: 'image', mediaRef: null }),
      ],
      'user-1',
    );
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([
      'scheduled-media/user-1/a.jpg',
      'scheduled-media/user-1/b.png',
    ]);
  });

  it('never removes a foreign or dot-segment path, even on an image slot', async () => {
    const remove = vi.fn(async () => ({ error: null }));
    const client = fakeServiceClient(remove);
    await removeCancelledMediaImages(
      client,
      [
        slot({ id: 's1', mediaKind: 'image', mediaRef: 'scheduled-media/user-2/a.jpg' }),
        slot({ id: 's2', mediaKind: 'image', mediaRef: 'scheduled-media/user-1/../../user-2/a.jpg' }),
        slot({ id: 's3', mediaKind: 'image', mediaRef: 'scheduled-media/user-1/./a.jpg' }),
        slot({ id: 's4', mediaKind: 'image', mediaRef: 'scheduled-media/user-1//a.jpg' }),
        slot({ id: 's5', mediaKind: 'image', mediaRef: 'other/a.jpg' }),
        slot({ id: 's6', mediaKind: 'image', mediaRef: 'scheduled-media/user-1/ok.jpg' }),
      ],
      'user-1',
    );
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(['scheduled-media/user-1/ok.jpg']);
  });

  it('touches no storage when no cancelled slot holds an image', async () => {
    const remove = vi.fn(async () => ({ error: null }));
    const client = fakeServiceClient(remove);
    await removeCancelledMediaImages(client, [slot({ id: 's1', taskId: 'task-1' })], 'user-1');
    expect(remove).not.toHaveBeenCalled();
    await removeCancelledMediaImages(client, [], 'user-1');
    expect(remove).not.toHaveBeenCalled();
  });

  it('logs loudly and resolves when the removal fails', async () => {
    const remove = vi.fn(async () => ({ error: { message: 'bucket gone' } }));
    const client = fakeServiceClient(remove);
    await expect(
      removeCancelledMediaImages(
        client,
        [slot({ id: 's1', mediaKind: 'image', mediaRef: 'scheduled-media/user-1/a.jpg' })],
        'user-1',
      ),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      '[api/schedule] cancel could not remove stored images',
      expect.objectContaining({ message: 'bucket gone' }),
      expect.objectContaining({ paths: ['scheduled-media/user-1/a.jpg'] }),
    );
  });
});
