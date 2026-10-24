//---------------
// scheduler runtime tests — startInternalScheduler wiring and the real
// tick runners (runPostMetricsTick / runBillingReconcileTick), mocked at
// the module boundary so no real timers, database or network are used.
//---------------

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

import { flushPostHog } from '../posthog-server';
import { collectPostMetrics, createPostMetricsStore } from '../metrics/post-metrics';
import { runBillingReconciliation, createReconcileStore } from '../billing/reconcile';
import { logger } from '../logger';
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

  it('builds and starts the scheduler with the two jobs when opted in', () => {
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
    // The injected clock is the real Date.
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
    // Still flushed (the queued events must not be lost).
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
    // scheduler-lease is mocked: acquire -> true, last success -> null.
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
