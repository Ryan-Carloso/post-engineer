//---------------
// scheduler tests — tick, lease-busy skip, and error survival.
//
// Driven with vitest fake timers against the dependency-injected core
// (lib/scheduler.ts); the real wiring lives in lib/scheduler-jobs.ts.
//---------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createScheduler, type SchedulerDeps, type SchedulerJob } from '../scheduler';

function makeDeps(overrides: Partial<SchedulerDeps> = {}): SchedulerDeps {
  return {
    jobs: [],
    acquireLease: vi.fn().mockResolvedValue(true),
    track: vi.fn(),
    logger: {
      info: vi.fn(),
      error: vi.fn(),
    },
    holder: 'test-holder',
    now: () => 1_000_000,
    ...overrides,
  };
}

function makeJob(overrides: Partial<SchedulerJob> = {}): SchedulerJob {
  return {
    name: 'post-metrics',
    intervalMs: 1_000,
    leaseTtlSeconds: 30 * 60,
    successEvent: 'post_metrics_run',
    run: vi.fn().mockResolvedValue({ success: true, errors: 0 }),
    ...overrides,
  };
}

describe('createScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the job on tick and emits the kept success event', async () => {
    const deps = makeDeps({
      jobs: [makeJob({ run: vi.fn().mockResolvedValue({ success: true, errors: 2 }) })],
    });
    const scheduler = createScheduler(deps);
    scheduler.start();
    expect(deps.jobs[0].run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(deps.jobs[0].run).toHaveBeenCalledTimes(1);
    // Same event name the /api/cron route used to emit.
    expect(deps.track).toHaveBeenCalledWith('post_metrics_run', {
      job: 'post-metrics',
      success: true,
      errors: 2,
    });
    scheduler.stop();
  });

  it('skips the tick when another replica holds the lease', async () => {
    const run = vi.fn().mockResolvedValue({ success: true, errors: 0 });
    const deps = makeDeps({ jobs: [makeJob({ run })], acquireLease: vi.fn().mockResolvedValue(false) });
    const scheduler = createScheduler(deps);
    scheduler.start();
    vi.mocked(deps.track).mockClear();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).not.toHaveBeenCalled();
    expect(deps.track).not.toHaveBeenCalled();
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('lease busy'),
      expect.anything(),
    );
    scheduler.stop();
  });

  it('survives a job error: reports it and keeps ticking', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ success: true, errors: 0 });
    const deps = makeDeps({ jobs: [makeJob({ run })] });
    const scheduler = createScheduler(deps);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('run failed'),
      expect.any(Error),
      {},
    );

    // The timer survived: the next tick runs again (and succeeds).
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(deps.track).toHaveBeenCalledWith('post_metrics_run', {
      job: 'post-metrics',
      success: true,
      errors: 0,
    });
    scheduler.stop();
  });

  it('emits scheduler_started once on start with the job config', () => {
    const deps = makeDeps({ jobs: [makeJob(), makeJob({ name: 'billing-reconcile', successEvent: 'billing_reconciled' })] });
    const scheduler = createScheduler(deps);
    scheduler.start();
    expect(deps.track).toHaveBeenCalledTimes(1);
    expect(deps.track).toHaveBeenCalledWith('scheduler_started', {
      jobs: [
        { name: 'post-metrics', intervalMs: 1_000, leaseTtlSeconds: 1_800 },
        { name: 'billing-reconcile', intervalMs: 1_000, leaseTtlSeconds: 1_800 },
      ],
      holder: 'test-holder',
      startedAt: new Date(1_000_000).toISOString(),
    });
    scheduler.stop();
  });

  it('stop() clears the timers so nothing runs afterwards', async () => {
    const deps = makeDeps({ jobs: [makeJob()] });
    const scheduler = createScheduler(deps);
    scheduler.start();
    scheduler.stop();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(deps.jobs[0].run).not.toHaveBeenCalled();
  });
});
