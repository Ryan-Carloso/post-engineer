import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createScheduler, type LeaseAcquisition, type SchedulerDeps, type SchedulerJob } from '../scheduler';

const HOUR = 60 * 60 * 1000;

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
    releaseLease: vi.fn(async () => undefined),
    track: vi.fn(),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    },
    holder: 'test-holder',
    now: () => Date.now(),
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
    expect(deps.track).toHaveBeenCalledWith('billing_reconciled', {
      route: 'POST /api/cron/billing-reconcile',
      status: 200,
    });
    scheduler.stop();
  });

  it('restart before the due gap does not run, then the job fires when the gap elapses', async () => {
    const deps = makeDeps({
      lastSuccessAt: new Date(Date.now() - 2 * HOUR),
      jobs: [makeJob()],
    });
    const scheduler = createScheduler(deps);
    scheduler.start();

    await settleImmediateTick();
    expect(deps.jobs[0].run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(HOUR);
    expect(deps.jobs[0].run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(22 * HOUR);
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
    expect(deps.recordSuccess).not.toHaveBeenCalled();
    expect(deps.track).toHaveBeenCalledTimes(1);
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

  it('survives an acquireLease failure: reports and retries on the next tick', async () => {
    const acquireLease = vi
      .fn()
      .mockRejectedValueOnce(new Error('acquire rpc failed: db down'))
      .mockResolvedValue({ acquired: true, lastSuccessAt: null } satisfies LeaseAcquisition);
    const deps = makeDeps({ jobs: [makeJob()], acquireLease });
    const scheduler = createScheduler(deps);
    scheduler.start();

    await settleImmediateTick();
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('run failed'),
      expect.any(Error),
      {},
    );
    expect(deps.jobs[0].run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(HOUR);
    expect(deps.jobs[0].run).toHaveBeenCalledTimes(1);
    expect(deps.recordSuccess).toHaveBeenCalledWith('billing-reconcile');
    scheduler.stop();
  });

  it('releases the lease after a successful run, with this holder', async () => {
    const deps = makeDeps({ lastSuccessAt: null, jobs: [makeJob()] });
    const scheduler = createScheduler(deps);
    scheduler.start();

    await settleImmediateTick();
    expect(deps.releaseLease).toHaveBeenCalledTimes(1);
    expect(deps.releaseLease).toHaveBeenCalledWith('billing-reconcile', 'test-holder');
    scheduler.stop();
  });

  it('releases the lease when the run throws', async () => {
    const run = vi.fn().mockRejectedValue(new Error('boom'));
    const deps = makeDeps({ lastSuccessAt: null, jobs: [makeJob({ run })] });
    const scheduler = createScheduler(deps);
    scheduler.start();

    await settleImmediateTick();
    expect(deps.releaseLease).toHaveBeenCalledWith('billing-reconcile', 'test-holder');
    scheduler.stop();
  });

  it('releases the lease when the job is not due, and logs that at debug level', async () => {
    const deps = makeDeps({ lastSuccessAt: new Date(Date.now() - HOUR), jobs: [makeJob()] });
    const scheduler = createScheduler(deps);
    scheduler.start();

    await settleImmediateTick();
    expect(deps.jobs[0].run).not.toHaveBeenCalled();
    expect(deps.releaseLease).toHaveBeenCalledTimes(1);
    expect(deps.logger.debug).toHaveBeenCalledWith(expect.stringContaining('not due yet'), expect.anything());
    expect(deps.logger.info).not.toHaveBeenCalledWith(expect.stringContaining('not due yet'), expect.anything());
    scheduler.stop();
  });

  it('never releases a lease it did not acquire', async () => {
    const deps = makeDeps({
      jobs: [makeJob()],
      acquireLease: vi.fn().mockResolvedValue({ acquired: false, lastSuccessAt: null } satisfies LeaseAcquisition),
    });
    const scheduler = createScheduler(deps);
    scheduler.start();

    await settleImmediateTick();
    expect(deps.releaseLease).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('logs a failed release and keeps ticking', async () => {
    const releaseLease = vi.fn().mockRejectedValueOnce(new Error('release rpc failed')).mockResolvedValue(undefined);
    const deps = makeDeps({ lastSuccessAt: null, jobs: [makeJob({ dueAfterMs: 0 })], releaseLease });
    const scheduler = createScheduler(deps);
    scheduler.start();

    await settleImmediateTick();
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('lease release failed'),
      expect.any(Error),
      {},
    );
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(deps.jobs[0].run).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('never overlaps a job with itself: a tick skips a job whose previous run has not ended', async () => {
    let finish: () => void = () => undefined;
    const run = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const deps = makeDeps({ lastSuccessAt: null, tickMs: 60_000, jobs: [makeJob({ run, dueAfterMs: 0 })] });
    const scheduler = createScheduler(deps);
    scheduler.start();

    await settleImmediateTick();
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(deps.acquireLease).toHaveBeenCalledTimes(1);
    expect(deps.logger.debug).toHaveBeenCalledWith(expect.stringContaining('previous run still going'), {});

    finish();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('a slow job does not hold back the other jobs of the tick', async () => {
    const slow = vi.fn(() => new Promise<void>(() => undefined));
    const fast = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      lastSuccessAt: null,
      tickMs: 60_000,
      jobs: [makeJob({ name: 'slow', run: slow, dueAfterMs: 0 }), makeJob({ name: 'fast', run: fast, dueAfterMs: 0 })],
    });
    const scheduler = createScheduler(deps);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(slow).toHaveBeenCalledTimes(1);
    expect(fast).toHaveBeenCalledTimes(3);
    scheduler.stop();
  });

  it('a 1h job at a 60 s tick runs once per hour, not every other hour', async () => {
    let t = 0;
    const deps = makeDeps({
      lastSuccessAt: null,
      tickMs: 60_000,
      now: () => Date.now(),
      jobs: [makeJob({ name: 'post-metrics', dueAfterMs: HOUR })],
    });
    const scheduler = createScheduler(deps);
    scheduler.start();

    while (t < 3 * HOUR) {
      await vi.advanceTimersByTimeAsync(60_000);
      t += 60_000;
    }
    const runs = vi.mocked(deps.jobs[0].run).mock.calls.length;
    expect(runs).toBeGreaterThanOrEqual(3);
    expect(runs).toBeLessThanOrEqual(4);
    scheduler.stop();
  });

  it('stop() clears the timers so nothing runs afterwards', async () => {
    const deps = makeDeps({ lastSuccessAt: null, jobs: [makeJob()] });
    const scheduler = createScheduler(deps);
    scheduler.start();

    await settleImmediateTick();
    expect(deps.jobs[0].run).toHaveBeenCalledTimes(1);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(10 * HOUR);
    expect(deps.jobs[0].run).toHaveBeenCalledTimes(1);
  });
});
