import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { recordProgressHistory } from '../schedule-progress-history';
import { logger } from '@/lib/logger';

//---------------
// recordProgressHistory — change-only, best-effort recording of observed
// (progress, stage) transitions into scheduled_post_progress_history.
//---------------

function mockClient(latestRows: unknown[], insertError: unknown = null) {
  const order = vi.fn(async () => ({ data: latestRows, error: null }));
  const insert = vi.fn(async () => ({ data: [], error: insertError }));
  const chain = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order,
    insert,
  };
  const from = vi.fn(() => chain);
  return { from, chain, order, insert };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recordProgressHistory', () => {
  it('inserts a row when the post has no history yet', async () => {
    const client = mockClient([]);

    await recordProgressHistory(client as never, 'user-1', [
      { postId: 'post-1', progress: 40, stage: 'subtitle' },
    ]);

    expect(client.from).toHaveBeenCalledWith('scheduled_post_progress_history');
    expect(client.chain.in).toHaveBeenCalledWith('post_id', ['post-1']);
    expect(client.insert).toHaveBeenCalledOnce();
    expect(client.insert).toHaveBeenCalledWith([
      { post_id: 'post-1', user_id: 'user-1', progress: 40, stage: 'subtitle' },
    ]);
  });

  it('skips the insert when progress and stage are unchanged', async () => {
    const client = mockClient([{ post_id: 'post-1', progress: 40, stage: 'subtitle' }]);

    await recordProgressHistory(client as never, 'user-1', [
      { postId: 'post-1', progress: 40, stage: 'subtitle' },
    ]);

    expect(client.order).toHaveBeenCalledOnce();
    expect(client.insert).not.toHaveBeenCalled();
  });

  it('inserts when progress changed and when only the stage changed', async () => {
    const client = mockClient([
      { post_id: 'post-1', progress: 40, stage: 'subtitle' },
      { post_id: 'post-2', progress: 50, stage: 'materials' },
    ]);

    await recordProgressHistory(client as never, 'user-1', [
      { postId: 'post-1', progress: 50, stage: 'materials' },
      { postId: 'post-2', progress: 50, stage: 'music_mood' },
    ]);

    expect(client.insert).toHaveBeenCalledOnce();
    expect(client.insert).toHaveBeenCalledWith([
      { post_id: 'post-1', user_id: 'user-1', progress: 50, stage: 'materials' },
      { post_id: 'post-2', user_id: 'user-1', progress: 50, stage: 'music_mood' },
    ]);
  });

  it('compares against the newest recorded row per post', async () => {
    const client = mockClient([
      { post_id: 'post-1', progress: 50, stage: 'materials' },
      { post_id: 'post-1', progress: 40, stage: 'subtitle' },
    ]);

    await recordProgressHistory(client as never, 'user-1', [
      { postId: 'post-1', progress: 50, stage: 'materials' },
    ]);

    expect(client.insert).not.toHaveBeenCalled();
  });

  it('dedupes multiple samples for the same post, keeping the last', async () => {
    const client = mockClient([]);

    await recordProgressHistory(client as never, 'user-1', [
      { postId: 'post-1', progress: 40, stage: 'subtitle' },
      { postId: 'post-1', progress: 50, stage: 'materials' },
    ]);

    expect(client.insert).toHaveBeenCalledWith([
      { post_id: 'post-1', user_id: 'user-1', progress: 50, stage: 'materials' },
    ]);
  });

  it('makes no queries when there are no samples', async () => {
    const client = mockClient([]);

    await recordProgressHistory(client as never, 'user-1', []);

    expect(client.from).not.toHaveBeenCalled();
  });

  it('skips malformed samples instead of failing', async () => {
    const client = mockClient([]);

    await recordProgressHistory(client as never, 'user-1', [
      { postId: '', progress: 40, stage: 'subtitle' },
      { postId: 'post-1', progress: Number.NaN, stage: 'subtitle' },
      { postId: 'post-2', progress: 10, stage: 'audio' },
    ]);

    expect(client.chain.in).toHaveBeenCalledWith('post_id', ['post-2']);
    expect(client.insert).toHaveBeenCalledWith([
      { post_id: 'post-2', user_id: 'user-1', progress: 10, stage: 'audio' },
    ]);
  });

  it('does not insert and does not throw when the lookup fails', async () => {
    const order = vi.fn(async () => ({ data: null, error: { message: 'db down' } }));
    const insert = vi.fn();
    const chain = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order,
      insert,
    };
    const client = { from: vi.fn(() => chain) };

    await expect(
      recordProgressHistory(client as never, 'user-1', [
        { postId: 'post-1', progress: 40, stage: 'subtitle' },
      ]),
    ).resolves.toBeUndefined();
    expect(insert).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
  });

  it('does not throw when the insert fails', async () => {
    const client = mockClient([], { message: 'db down' });

    await expect(
      recordProgressHistory(client as never, 'user-1', [
        { postId: 'post-1', progress: 40, stage: 'subtitle' },
      ]),
    ).resolves.toBeUndefined();
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
  });
});
