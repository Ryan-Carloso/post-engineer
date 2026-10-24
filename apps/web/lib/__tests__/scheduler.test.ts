//---------------
// scheduler tests — startup first-run, restart-safe due-check
// (persisted last success), lease-busy skip, and error survival.
//
// Driven with vitest fake timers against the dependency-injected core
// (lib/scheduler.ts); the real wiring lives in lib/scheduler-jobs.ts.
// The deps mock simulates the DB persistence: recordSuccess moves the
// last-success timestamp that acquireLease hands back, exactly like the
// real scheduler_leases row.
//---------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createScheduler, type LeaseAcquisition, type SchedulerDeps, type SchedulerJob } from '../scheduler';

const HOUR = 60 * 60 * 1000;

//---------------
// deps with simulated persistence: `last` moves on recordSuccess.
//---------------
function makeDeps(
  overrides: Partial<SchedulerDeps> & { lastSuccessAt?: Date | null } = {},
): SchedulerDeps {
  const { lastSuccessAt = null, ...rest } = overrides;
  const deps: SchedulerDeps = {
    jobs: [],
    tickMs: HOUR,
    acquireLease: vi.fn(async () => ({ acquired: true, lastSuccessAt: last })),
    recordSuccess: vi.fn(async () => {
      last = new Date(Date.now());
    }),
    track: vi.fn(),
    logger: {
      info: vi.fn(),
      error: vi.fn(),
    },
    holder: 'test-holder',
    now: () => Date.now(), // follows the fake clock
    ...rest,
  };
  let last: Date | null = lastSuccessAt;
  return deps;
}

function makeJob(overrides: Partial<SchedulerJob> = {}): SchedulerJob {
  return {
    name: 'billing-reconcile',
    dueAfterMs: 24 * HOUR,
    leaseTtlSeconds: 30 * 60,
    successEvent: 'billing_reconciled',
    routeLabel: 'POST /api/cron/billing-reconcile',
    run: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

async function settleImmediateTick(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe('createScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a never-run job immediately at startup (first run / catch-up)', async () => {
    const deps = makeDeps({ lastSuccessAt: null, jobs: [makeJob()] });
    const scheduler = createScheduler(deps);
    scheduler.start();

    await settleImmediateTick();
    expect(deps.jobs[0].run).toHaveBeenCalledTimes(1);
    expect(deps.recordSuccess).toHaveBeenCalledWith('billing-reconcile');
    // Same event name + property shape the /api/cron route emitted.
    expect(deps.track).toHaveBeenCalledWith('billing_reconciled', {
      route: 'POST /api/cron/billing-reconcile',
      status: 200,
    });
    scheduler.stop();
  });

  it('restart before the due gap does not run, then the job fires when the gap elapses', async () => {
    // Simulate a restart 2h after the last successful run: the immediate
    // startup tick must NOT run the 24h job, and hourly ticks must keep
    // skipping until the persisted gap reaches 24h.
    const deps = makeDeps({
      lastSuccessAt: new Date(Date.now() - 2 * HOUR),
      jobs: [makeJob()],
    });
    const scheduler = createScheduler(deps);
    scheduler.start();

    await settleImmediateTick();
    expect(deps.jobs[0].run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(HOUR); // 3h since last success
    expect(deps.jobs[0].run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(22 * HOUR); // 25h since last success
    expect(deps.jobs[0].run).toHaveBeenCalledTimes(1);
    expect(deps.recordSuccess).toHaveBeenCalledWith('billing-reconcile');
    expect(deps.track).toHaveBeenCalledWith('billing_reconciled', {
      route: 'POST /api/cron/billing-reconcile',
      status: 200,
    });
    scheduler.stop();
  });

  it('1h gap (post-metrics): runs at startup and then once per hour', async () => {
    const deps = makeDeps({
      lastSuccessAt: null,
      jobs: [
        makeJob({
          dueAfterMs: HOUR,
          name: 'post-metrics',
          successEvent: 'post_metrics_run',
          routeLabel: 'POST /api/cron/post-metrics',
        }),
      ],
    });
    const scheduler = createScheduler(deps);
    scheduler.start();

    await settleImmediateTick();
    await vi.advanceTimersByTimeAsync(HOUR);
    // Startup first-run + one hourly tick (the next hourly tick is due
    // only after another full hour).
    expect(deps.jobs[0].run).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('skips the tick when another replica holds the lease', async () => {
    const deps = makeDeps({
      lastSuccessAt: null,
      jobs: [makeJob()],
      acquireLease: vi
        .fn()
        .mockResolvedValue({ acquired: false, lastSuccessAt: null } satisfies LeaseAcquisition),
    });
    const scheduler = createScheduler(deps);
    scheduler.start();
    vi.mocked(deps.track).mockClear();

    await settleImmediateTick();
    expect(deps.jobs[0].run).not.toHaveBeenCalled();
    expect(deps.recordSuccess).not.toHaveBeenCalled();
    expect(deps.track).not.toHaveBeenCalled();
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('lease busy'),
      expect.anything(),
    );
    scheduler.stop();
  });

  it('survives a job error: reports (scrubbed, via logger) and retries on the next tick', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);
    const deps = makeDeps({ lastSuccessAt: null, jobs: [makeJob({ run })] });
    const scheduler = createScheduler(deps);
    scheduler.start();

    await settleImmediateTick();
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('run failed'),
      expect.any(Error),
      {},
    );
    // A failed run is NOT recorded as a success.
    expect(deps.recordSuccess).not.toHaveBeenCalled();
    expect(deps.track).toHaveBeenCalledTimes(1); // scheduler_started only

    // The timer survived: the next tick runs again (still due — last
    // success never recorded) and succeeds.
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(run).toHaveBeenCalledTimes(2);
    expect(deps.recordSuccess).toHaveBeenCalledWith('billing-reconcile');
    expect(deps.track).toHaveBeenCalledWith('billing_reconciled', {
      route: 'POST /api/cron/billing-reconcile',
      status: 200,
    });
    scheduler.stop();
  });

  it('emits scheduler_started once on start with the job config', () => {
    const deps = makeDeps({
      lastSuccessAt: null,
      jobs: [makeJob(), makeJob({ name: 'post-metrics', dueAfterMs: HOUR, successEvent: 'post_metrics_run' })],
    });
    const scheduler = createScheduler(deps);
    scheduler.start();

    expect(deps.track).toHaveBeenCalledTimes(1);
    expect(deps.track).toHaveBeenCalledWith('scheduler_started', {
      jobs: [
        { name: 'billing-reconcile', dueAfterMs: 24 * HOUR, leaseTtlSeconds: 1_800 },
        { name: 'post-metrics', dueAfterMs: HOUR, leaseTtlSeconds: 1_800 },
      ],
      holder: 'test-holder',
      startedAt: new Date(Date.now()).toISOString(),
    });
    scheduler.stop();
  });

  it('stop() clears the timers so nothing runs afterwards', async () => {
    const deps = makeDeps({ lastSuccessAt: new Date(Date.now()), jobs: [makeJob()] });
    const scheduler = createScheduler(deps);
    scheduler.start();
    scheduler.stop();

    await settleImmediateTick();
    await vi.advanceTimersByTimeAsync(10 * HOUR);
    expect(deps.jobs[0].run).not.toHaveBeenCalled();
  });
});
