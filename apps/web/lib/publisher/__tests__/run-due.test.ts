// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { runPublishDue, type RunDueDeps } from '@/lib/publisher/run-due';
import type { ExpiredSlot } from '@/lib/publisher/store-types';
import type { PublishSlot } from '@/lib/publisher/types';
import { NOW, SLOT_ID, USER_ID, UPLOAD_ID, makeSlot, makeStore, readyUpload } from './helpers';

function slotNamed(id: string): PublishSlot {
  return makeSlot({ id });
}

function build(overrides: Partial<RunDueDeps> = {}, claims: Array<PublishSlot | null> = []) {
  let current = NOW.getTime();
  const queue = [...claims];
  const store = makeStore({ claimNextSlot: vi.fn(async () => queue.shift() ?? null) });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps: RunDueDeps = {
    store,
    publishSlot: vi.fn(async () => true),
    failSlot: vi.fn(async () => undefined),
    clock: () => new Date(current),
    logger,
    maxSlots: 20,
    budgetMs: 600_000,
    leaseSeconds: 1800,
    ...overrides,
  };
  return { deps, store, logger, advance: (ms: number) => (current += ms) };
}

describe('runPublishDue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing and logs nothing when no slot is due', async () => {
    const { deps, logger } = build();
    expect(await runPublishDue(deps)).toEqual({ claimed: 0, published: 0, expired: 0, failed: 0, stoppedBy: 'empty' });
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('claims one slot at a time with the attempt lease until none is left and counts the published ones', async () => {
    const { deps, store, logger } = build({}, [slotNamed('a'), slotNamed('b'), slotNamed('c')]);
    vi.mocked(deps.publishSlot).mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const report = await runPublishDue(deps);
    expect(report).toEqual({ claimed: 3, published: 2, expired: 0, failed: 0, stoppedBy: 'empty' });
    expect(store.claimNextSlot).toHaveBeenCalledTimes(4);
    expect(store.claimNextSlot).toHaveBeenCalledWith(NOW, 1800);
    expect(logger.info).toHaveBeenCalledWith('[publisher] tick counters', report);
  });

  it('stops at the per-tick cap without claiming one more', async () => {
    const { deps, store } = build({ maxSlots: 2 }, [slotNamed('a'), slotNamed('b'), slotNamed('c')]);
    const report = await runPublishDue(deps);
    expect(report).toMatchObject({ claimed: 2, stoppedBy: 'cap' });
    expect(store.claimNextSlot).toHaveBeenCalledTimes(2);
  });

  it('stops claiming once the time budget is spent', async () => {
    const { deps, store, advance } = build({ budgetMs: 1000 }, [slotNamed('a'), slotNamed('b')]);
    vi.mocked(deps.publishSlot).mockImplementation(async () => {
      advance(1500);
      return true;
    });
    const report = await runPublishDue(deps);
    expect(report).toMatchObject({ claimed: 1, published: 1, stoppedBy: 'budget' });
    expect(store.claimNextSlot).toHaveBeenCalledTimes(1);
  });

  it('expires inactive slots first and removes their media', async () => {
    const expired: ExpiredSlot = { id: SLOT_ID, userId: USER_ID, mediaKind: 'upload', mediaRef: UPLOAD_ID };
    const { deps, store } = build();
    vi.mocked(store.expireInactiveReadySlots).mockResolvedValue([expired]);
    vi.mocked(store.getVideoUpload).mockResolvedValue(readyUpload());
    const report = await runPublishDue(deps);
    expect(report.expired).toBe(1);
    expect(store.removeStorageObject).toHaveBeenCalledWith('videos', `${USER_ID}/${UPLOAD_ID}.mp4`);
    expect(vi.mocked(store.expireInactiveReadySlots).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(store.claimNextSlot).mock.invocationCallOrder[0]!,
    );
  });

  it('a media cleanup failure for one expired slot is logged and does not stop the tick', async () => {
    const { deps, store, logger } = build({}, [slotNamed('a')]);
    vi.mocked(store.expireInactiveReadySlots).mockResolvedValue([{ id: 'x', userId: USER_ID, mediaKind: 'image', mediaRef: `scheduled-media/${USER_ID}/p.png` }]);
    vi.mocked(store.removeStorageObject).mockRejectedValue(new Error('bucket error'));
    const report = await runPublishDue(deps);
    expect(report).toMatchObject({ expired: 1, claimed: 1, published: 1 });
    expect(logger.error).toHaveBeenCalledWith('[publisher] expired slot media cleanup failed', expect.any(Error), { slotId: 'x' });
  });

  it('a connection failure while cleaning expired media stops the tick', async () => {
    const { deps, store } = build();
    vi.mocked(store.expireInactiveReadySlots).mockResolvedValue([{ id: 'x', userId: USER_ID, mediaKind: 'image', mediaRef: `scheduled-media/${USER_ID}/p.png` }]);
    vi.mocked(store.removeStorageObject).mockRejectedValue(new TypeError('fetch failed'));
    await expect(runPublishDue(deps)).rejects.toThrow('fetch failed');
    expect(store.claimNextSlot).not.toHaveBeenCalled();
  });

  it('an unexpected error fails that slot once and the tick goes on with the next one', async () => {
    const { deps, logger } = build({}, [slotNamed('a'), slotNamed('b')]);
    vi.mocked(deps.publishSlot).mockRejectedValueOnce(new Error('bad row token=abc')).mockResolvedValueOnce(true);
    const report = await runPublishDue(deps);
    expect(report).toMatchObject({ claimed: 2, published: 1, failed: 1 });
    expect(deps.failSlot).toHaveBeenCalledTimes(1);
    expect(deps.failSlot).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), 'unexpected publish error: bad row token=[redacted]');
    expect(logger.error).toHaveBeenCalledWith('[publisher] slot failed unexpectedly', expect.any(Error), { slotId: 'a' });
  });

  it('logs and continues when failing the slot itself fails', async () => {
    const { deps, logger } = build({}, [slotNamed('a'), slotNamed('b')]);
    vi.mocked(deps.publishSlot).mockRejectedValueOnce(new Error('bad row')).mockResolvedValueOnce(true);
    vi.mocked(deps.failSlot).mockRejectedValueOnce(new Error('update refused'));
    const report = await runPublishDue(deps);
    expect(report).toMatchObject({ claimed: 2, published: 1, failed: 1 });
    expect(logger.error).toHaveBeenCalledWith('[publisher] could not fail the slot', expect.any(Error), { slotId: 'a' });
  });

  it('a connection failure while publishing stops the tick without failing the slot', async () => {
    const { deps, store } = build({}, [slotNamed('a'), slotNamed('b')]);
    vi.mocked(deps.publishSlot).mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1:443'));
    await expect(runPublishDue(deps)).rejects.toThrow('ECONNREFUSED');
    expect(deps.failSlot).not.toHaveBeenCalled();
    expect(store.claimNextSlot).toHaveBeenCalledTimes(1);
  });

  it('a connection failure while failing the slot stops the tick', async () => {
    const { deps } = build({}, [slotNamed('a'), slotNamed('b')]);
    vi.mocked(deps.publishSlot).mockRejectedValue(new Error('bad row'));
    vi.mocked(deps.failSlot).mockRejectedValue(new TypeError('fetch failed'));
    await expect(runPublishDue(deps)).rejects.toThrow('fetch failed');
  });

  it('propagates a claim failure so the job can report the outage', async () => {
    const { deps, store } = build();
    vi.mocked(store.claimNextSlot).mockRejectedValue(new Error('[publisher-store] claim_next_publish_slot failed: fetch failed'));
    await expect(runPublishDue(deps)).rejects.toThrow('fetch failed');
  });
});
