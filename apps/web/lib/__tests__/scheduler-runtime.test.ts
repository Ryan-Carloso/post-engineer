import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { createSchedulerMock, schedulerHandle, createdDeps } = vi.hoisted(() => {
  const createdDeps: unknown[] = [];
  const schedulerHandle = {
    start: vi.fn(),
    stop: vi.fn(),
  };
  const createSchedulerMock = vi.fn((deps: unknown) => {
    createdDeps.push(deps);
    return schedulerHandle;
  });
  return { createSchedulerMock, schedulerHandle, createdDeps };
});

vi.mock('../scheduler', () => ({ createScheduler: createSchedulerMock }));
vi.mock('../scheduler-lease', () => ({
  tryAcquireSchedulerLease: vi.fn().mockResolvedValue(true),
  getSchedulerLastSuccess: vi.fn().mockResolvedValue(null),
  recordSchedulerSuccess: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({})) }));
vi.mock('../metrics/post-metrics', () => ({
  collectPostMetrics: vi.fn().mockResolvedValue({ errors: [] }),
  createPostMetricsStore: vi.fn(() => ({ store: true })),
}));
vi.mock('../metrics/provider-counters', () => ({ fetchProviderCounters: vi.fn() }));
vi.mock('../metrics/youtube-account-resolution', () => ({ resolveYouTubeMetricsTarget: vi.fn() }));
vi.mock('../engine-tasks', () => ({ fetchEnginePostMetricsSource: vi.fn() }));
vi.mock('../billing/reconcile', () => ({
  runBillingReconciliation: vi.fn().mockResolvedValue({ errors: [] }),
  createReconcileStore: vi.fn(() => ({ reconcile: true })),
}));
vi.mock('../analytics', () => ({ trackApiEvent: vi.fn() }));
vi.mock('../posthog-server', () => ({ flushPostHog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../logger', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));
vi.mock('../videos/signed-upload', () => ({
  sweepExpiredVideoUploads: vi.fn().mockResolvedValue(0),
  createSupabaseVideoUploadStore: vi.fn(() => ({ store: true })),
  createSupabaseVideoUploadStorage: vi.fn(() => ({ storage: true })),
}));

vi.mock('../social-token-refresh', () => ({
  refreshExpiringSocialTokens: vi.fn().mockResolvedValue({
    refreshed: 1, failed: 0, unauthorized: 0, skipped: 0, truncated: false,
  }),
}));
vi.mock('../social-token-refresh-store', () => ({
  createTokenRefreshStore: vi.fn(() => ({ tokenStore: true })),
}));
vi.mock('../instagram', () => ({
  InstagramService: vi.fn(function InstagramService() {
    return {
      refreshLongLivedToken: vi.fn().mockResolvedValue({ accessToken: 'ig-new', tokenType: 'bearer', expiresIn: 100 }),
    };
  }),
}));
vi.mock('../threads', () => ({
  refreshThreadsToken: vi.fn().mockResolvedValue({ access_token: 'th-new', expires_in: 200 }),
}));
vi.mock('../owner-alert-mail', () => ({ notifyAccountBreak: vi.fn().mockResolvedValue(undefined) }));

import { flushPostHog } from '../posthog-server';
import { refreshExpiringSocialTokens } from '../social-token-refresh';
import { createTokenRefreshStore } from '../social-token-refresh-store';
import { refreshThreadsToken } from '../threads';
import { notifyAccountBreak } from '../owner-alert-mail';
import { isUnauthorizedError } from '../account-break';
import { collectPostMetrics, createPostMetricsStore } from '../metrics/post-metrics';
import { runBillingReconciliation, createReconcileStore } from '../billing/reconcile';
import { logger } from '../logger';
import {
  createSupabaseVideoUploadStorage,
  createSupabaseVideoUploadStore,
  sweepExpiredVideoUploads,
} from '../videos/signed-upload';
import {
  isSchedulerEnabled,
  SCHEDULER_JOBS,
  startInternalScheduler,
} from '../scheduler-jobs';

const REAL_NODE_ENV = process.env.NODE_ENV;
const REAL_FLAG = process.env.SCHEDULER_ENABLED;

function setEnv(name: 'NODE_ENV' | 'SCHEDULER_ENABLED', value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env[name];
  else env[name] = value;
}

beforeEach(() => {
  createdDeps.length = 0;
  createSchedulerMock.mockClear();
  schedulerHandle.start.mockClear();
  vi.mocked(collectPostMetrics).mockClear();
  vi.mocked(runBillingReconciliation).mockClear();
  vi.mocked(flushPostHog).mockClear();
  vi.mocked(logger.error).mockClear();
  vi.mocked(logger.info).mockClear();
  vi.mocked(sweepExpiredVideoUploads).mockReset();
  vi.mocked(sweepExpiredVideoUploads).mockResolvedValue(0);
  vi.mocked(createSupabaseVideoUploadStore).mockClear();
  vi.mocked(createSupabaseVideoUploadStorage).mockClear();
});

afterEach(() => {
  setEnv('NODE_ENV', REAL_NODE_ENV);
  setEnv('SCHEDULER_ENABLED', REAL_FLAG);
});

describe('startInternalScheduler', () => {
  it('returns null when disabled (dev/test without the explicit opt-in)', () => {
    delete process.env.SCHEDULER_ENABLED;
    setEnv('NODE_ENV', 'test');
    expect(isSchedulerEnabled()).toBe(false);
    expect(startInternalScheduler()).toBeNull();
    expect(createSchedulerMock).not.toHaveBeenCalled();
  });

  it('builds and starts the scheduler with the configured jobs when opted in', () => {
    process.env.SCHEDULER_ENABLED = 'true';
    const handle = startInternalScheduler();
    expect(handle).toBe(schedulerHandle);
    expect(schedulerHandle.start).toHaveBeenCalledTimes(1);
    expect(createdDeps).toHaveLength(1);
    const deps = createdDeps[0] as { jobs: unknown[] };
    expect(deps.jobs).toEqual(SCHEDULER_JOBS);
  });

  it('post-metrics tick collects with the service store and flushes PostHog', async () => {
    process.env.SCHEDULER_ENABLED = 'true';
    startInternalScheduler();
    const deps = createdDeps[0] as {
      jobs: Array<{ name: string; run: () => Promise<void> }>;
    };
    const job = deps.jobs.find((j) => j.name === 'post-metrics')!;
    await job.run();

    expect(createPostMetricsStore).toHaveBeenCalledWith({});
    expect(collectPostMetrics).toHaveBeenCalledTimes(1);
    const args = vi.mocked(collectPostMetrics).mock.calls[0][0];
    expect(args).toMatchObject({ store: true, fetchTaskSource: expect.anything() });
    expect((args as { now: () => Date }).now()).toBeInstanceOf(Date);
    expect(flushPostHog).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('post-metrics tick logs when the report carries errors', async () => {
    vi.mocked(collectPostMetrics).mockResolvedValueOnce({
      checked: 1,
      recorded: 0,
      errors: ['boom'],
      truncated: false,
    });
    process.env.SCHEDULER_ENABLED = 'true';
    startInternalScheduler();
    const deps = createdDeps[0] as {
      jobs: Array<{ name: string; run: () => Promise<void> }>;
    };
    await deps.jobs.find((j) => j.name === 'post-metrics')!.run();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('completed with errors'),
      null,
      { errors: ['boom'] },
    );
    expect(flushPostHog).toHaveBeenCalledTimes(1);
  });

  it('billing-reconcile tick runs the reconciliation', async () => {
    process.env.SCHEDULER_ENABLED = 'true';
    startInternalScheduler();
    const deps = createdDeps[0] as {
      jobs: Array<{ name: string; run: () => Promise<void> }>;
    };
    await deps.jobs.find((j) => j.name === 'billing-reconcile')!.run();

    expect(createReconcileStore).toHaveBeenCalledWith({});
    expect(runBillingReconciliation).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('video-upload sweep tick removes expired uploads through the store seam', async () => {
    process.env.SCHEDULER_ENABLED = 'true';
    startInternalScheduler();
    const deps = createdDeps[0] as {
      jobs: Array<{ name: string; run: () => Promise<void> }>;
    };
    await deps.jobs.find((j) => j.name === 'video-upload-sweep')!.run();

    expect(createSupabaseVideoUploadStore).toHaveBeenCalledTimes(1);
    expect(createSupabaseVideoUploadStorage).toHaveBeenCalledTimes(1);
    expect(sweepExpiredVideoUploads).toHaveBeenCalledWith({ store: true }, { storage: true }, expect.any(Date));
    expect(logger.info).not.toHaveBeenCalledWith(
      '[scheduler/video-upload-sweep] removed expired uploads',
      expect.anything(),
    );
  });

  it('video-upload sweep tick logs when it removed uploads', async () => {
    vi.mocked(sweepExpiredVideoUploads).mockResolvedValueOnce(2);
    process.env.SCHEDULER_ENABLED = 'true';
    startInternalScheduler();
    const deps = createdDeps[0] as {
      jobs: Array<{ name: string; run: () => Promise<void> }>;
    };
    await deps.jobs.find((j) => j.name === 'video-upload-sweep')!.run();
    expect(logger.info).toHaveBeenCalledWith('[scheduler/video-upload-sweep] removed expired uploads', {
      removed: 2,
    });
  });

  it('billing-reconcile tick logs when the report carries errors', async () => {
    vi.mocked(runBillingReconciliation).mockResolvedValueOnce({
      zombiesRefunded: [],
      zombiesAlreadySettled: [],
      stuckAutoRefunded: [],
      stuckSkippedValueDelivered: [],
      stuckCompletedBackfilled: [],
      stuckDeferred: [],
      errors: [{ scope: 'zombie_refund', ref: 'z1', message: 'refund failed' }],
    });
    process.env.SCHEDULER_ENABLED = 'true';
    startInternalScheduler();
    const deps = createdDeps[0] as {
      jobs: Array<{ name: string; run: () => Promise<void> }>;
    };
    await deps.jobs.find((j) => j.name === 'billing-reconcile')!.run();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('completed with errors'),
      null,
      {
        errors: [{ scope: 'zombie_refund', ref: 'z1', message: 'refund failed' }],
      },
    );
  });

  it('acquireLease wiring acquires the lease and reads the persisted last success', async () => {
    process.env.SCHEDULER_ENABLED = 'true';
    startInternalScheduler();
    const deps = createdDeps[0] as {
      acquireLease: (job: string, ttl: number, holder: string) => Promise<{ acquired: boolean; lastSuccessAt: Date | null }>;
    };
    const result = await deps.acquireLease('post-metrics', 1800, 'h1');
    expect(result).toEqual({ acquired: true, lastSuccessAt: null });
  });

  it('the scheduler clock injects the real Date.now', () => {
    process.env.SCHEDULER_ENABLED = 'true';
    startInternalScheduler();
    const deps = createdDeps[0] as { now: () => number; holder: string };
    expect(deps.now()).toBeTypeOf('number');
    expect(deps.holder).toContain(':');
  });
});

describe('social-token-refresh tick', () => {
  async function runTick() {
    process.env.SCHEDULER_ENABLED = 'true';
    startInternalScheduler();
    const deps = createdDeps[0] as {
      jobs: Array<{ name: string; dueAfterMs: number; run: () => Promise<void> }>;
    };
    const job = deps.jobs.find((j) => j.name === 'social-token-refresh')!;
    await job.run();
    return { job, refreshDeps: vi.mocked(refreshExpiringSocialTokens).mock.calls.at(-1)![0] };
  }

  it('runs daily with the Supabase store, the real break check, and logs the report', async () => {
    const { job, refreshDeps } = await runTick();

    expect(job.dueAfterMs).toBe(24 * 60 * 60 * 1000);
    expect(createTokenRefreshStore).toHaveBeenCalledWith({});
    expect(refreshDeps.store).toEqual({ tokenStore: true });
    expect(refreshDeps.isUnauthorized).toBe(isUnauthorizedError);
    expect(logger.info).toHaveBeenCalledWith('[scheduler/social-token-refresh] completed', {
      refreshed: 1, failed: 0, unauthorized: 0, skipped: 0, truncated: false,
    });
    expect(flushPostHog).toHaveBeenCalled();
  });

  it('maps both provider refresh answers to the shared shape', async () => {
    const { refreshDeps } = await runTick();

    await expect(refreshDeps.refreshers.instagram('ig-old')).resolves.toEqual({ accessToken: 'ig-new', expiresInSeconds: 100 });
    await expect(refreshDeps.refreshers.threads('th-old')).resolves.toEqual({ accessToken: 'th-new', expiresInSeconds: 200 });
    expect(refreshThreadsToken).toHaveBeenCalledWith('th-old');
  });

  it('emails the owner about a dead account through the deduped account-break alert', async () => {
    const { refreshDeps } = await runTick();
    const error = new Error('dead');
    const candidate = {
      id: 'row-1', userId: 'u1', provider: 'instagram' as const, providerAccountId: 'ig-1',
      tokens: { access_token: 'x' }, updatedAt: 't',
    };

    refreshDeps.reportBroken(candidate, error);

    expect(notifyAccountBreak).toHaveBeenCalledWith({
      userId: 'u1', provider: 'instagram', accountId: 'ig-1', socialAccountId: 'row-1', error,
    });
  });

  it('logs a failed owner alert instead of dropping it', async () => {
    const { refreshDeps } = await runTick();
    const mailError = new Error('smtp down');
    vi.mocked(notifyAccountBreak).mockRejectedValueOnce(mailError);
    const candidate = {
      id: 'row-1', userId: 'u1', provider: 'threads' as const, providerAccountId: 'th-1',
      tokens: { access_token: 'x' }, updatedAt: 't',
    };

    refreshDeps.reportBroken(candidate, new Error('dead'));
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith('[scheduler/social-token-refresh] owner alert failed', mailError);
    });
  });
});
