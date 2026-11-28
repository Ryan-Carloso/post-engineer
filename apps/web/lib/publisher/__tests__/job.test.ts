// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runPublishDue, sendDiscord, logger } = vi.hoisted(() => ({
  runPublishDue: vi.fn(),
  sendDiscord: vi.fn(async () => true),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), generateLogId: vi.fn(() => 'log-id') },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/upload/publish-content', () => ({ publishContent: vi.fn() }));
vi.mock('@/lib/publisher/store', () => ({ createPublisherStore: vi.fn(() => ({ store: true })) }));
vi.mock('@/lib/publisher/run-due', () => ({ runPublishDue: (...args: unknown[]) => runPublishDue(...args) }));
vi.mock('@/lib/publisher/discord', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/publisher/discord')>()),
  sendDiscord: (...args: unknown[]) => sendDiscord(...(args as [])),
}));
vi.mock('@/lib/publisher/owner-mail', () => ({ notifyPublishFailed: vi.fn(), notifyPublishPartial: vi.fn() }));
vi.mock('@/lib/publisher/events', () => ({ trackPublishEvent: vi.fn() }));

import { ATTEMPT_LEASE_SECONDS, PUBLISH_DUE_MAX_SLOTS_PER_TICK, PUBLISH_DUE_TICK_BUDGET_MS } from '@/lib/publisher/constants';
import { announcePublishScheduler, runPublishDueTick } from '@/lib/publisher/job';

describe('runPublishDueTick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the due publisher with the tick caps and the attempt lease', async () => {
    runPublishDue.mockResolvedValue({ claimed: 0 });
    await runPublishDueTick();
    expect(runPublishDue).toHaveBeenCalledWith(
      expect.objectContaining({
        store: { store: true },
        maxSlots: PUBLISH_DUE_MAX_SLOTS_PER_TICK,
        budgetMs: PUBLISH_DUE_TICK_BUDGET_MS,
        leaseSeconds: ATTEMPT_LEASE_SECONDS,
        logger,
      }),
    );
  });

  it('reports an outage once and returns normally so the scheduler does not log every tick', async () => {
    runPublishDue.mockRejectedValue(new TypeError('fetch failed'));
    await expect(runPublishDueTick()).resolves.toBeUndefined();
    await expect(runPublishDueTick()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('[publisher] connection outage started', expect.any(TypeError), expect.anything());
  });

  it('logs the end of the outage when a tick succeeds again', async () => {
    runPublishDue.mockRejectedValueOnce(new TypeError('fetch failed'));
    await runPublishDueTick();
    runPublishDue.mockResolvedValueOnce({ claimed: 0 });
    await runPublishDueTick();
    expect(logger.info).toHaveBeenCalledWith('[publisher] connection outage over', expect.anything());
  });

  it('rethrows any other failure so the scheduler reports it', async () => {
    runPublishDue.mockRejectedValue(new Error('claim_next_publish_slot returned a row without an id'));
    await expect(runPublishDueTick()).rejects.toThrow('without an id');
  });

  it('wires the publish dependencies of one slot', async () => {
    runPublishDue.mockResolvedValue({ claimed: 0 });
    await runPublishDueTick();
    const deps = runPublishDue.mock.calls[0]![0] as { publishSlot: unknown; failSlot: unknown; clock: () => Date };
    expect(deps.publishSlot).toBeTypeOf('function');
    expect(deps.failSlot).toBeTypeOf('function');
    expect(deps.clock()).toBeInstanceOf(Date);
  });
});

describe('announcePublishScheduler', () => {
  it('sends the scheduler started message to Discord', () => {
    announcePublishScheduler();
    expect(sendDiscord).toHaveBeenCalledWith('🗓️ Publish scheduler started');
  });
});
