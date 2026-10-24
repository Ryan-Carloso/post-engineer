//---------------
// scheduler — the in-process scheduler core.
//
// Replaces the pg_cron + pg_net HTTP triggering of /api/cron/*: the jobs
// now run INSIDE the web app (no public HTTP route, no CRON_SECRET, no
// pg_cron), driven from instrumentation.ts's register().
//
// Due-check design (restart-safe): the process does NOT trust a timer
// that starts at boot — a deploy or crash-restart would postpone a
// 24h-daily job forever. Instead a frequent tick (SCHEDULER_TICK_MS, 1h,
// first tick right at startup) checks each job's LAST SUCCESSFUL RUN,
// persisted in the database (scheduler_leases.last_success_at, migration
// 027): a job is due when it never ran (first run at startup = catch-up
// after downtime) or when now - last_success_at >= dueAfterMs. Restarts
// and missed ticks are caught up on the next tick, never lost.
//
// Multi-replica safety: every tick first tries to acquire a database
// lease (try_acquire_scheduler_lease). With several app replicas
// running, only the lease winner reaches the due-check; the others skip.
// A replica that crashes mid-run keeps the lease until the TTL expires,
// so at most one job runs at a time and nothing double-runs per tick.
//
// Fault isolation: a job that throws is logged (which reports the
// scrubbed $exception to PostHog — lib/logger.ts reportErrorToPostHog →
// scrubSecrets) and the timer survives — the next tick runs again (the
// collectors are idempotent, and last_success_at only moves on success,
// so an interrupted run is retried).
//
// This module is dependency-injected (jobs, lease, tracking, timers) so
// tests can drive ticks with fake timers and mocks; lib/scheduler-jobs.ts
// wires the real implementations, and lib/__tests__/scheduler.test.ts
// pins first-run / catch-up / lease-busy / error-survival behavior.
//
// The global timers are used (not node:timers) so vitest's fake timers
// can intercept them in tests.
//---------------

export interface SchedulerJob {
  // Stable job name; doubles as the lease key.
  name: string;
  // Minimum gap between SUCCESSFUL runs, checked against the persisted
  // last_success_at (>= this gap, or never run, = due).
  dueAfterMs: number;
  // Lease TTL: must comfortably exceed the job's worst-case runtime so a
  // slow run never lets a second replica start a duplicate.
  leaseTtlSeconds: number;
  // PostHog event emitted after a successful run (kept identical to the
  // former /api/cron route telemetry: 'post_metrics_run' and
  // 'billing_reconciled'), with the same property shape the route's
  // withApiErrorReporting wrapper used: { route, status }.
  successEvent: string;
  routeLabel: string;
  // The job itself. Throw = failed run (not recorded as success).
  run: () => Promise<unknown>;
}

export interface SchedulerLogger {
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, error: unknown, context?: Record<string, unknown>): void;
}

export interface LeaseAcquisition {
  // True = this holder owns the lease for this tick.
  acquired: boolean;
  // When this job last completed successfully (null = never).
  lastSuccessAt: Date | null;
}

export interface SchedulerDeps {
  jobs: SchedulerJob[];
  // How often the due-check runs (frequent; the first tick is immediate).
  tickMs: number;
  // Acquire the DB lease and read the job's last success. False = another
  // replica owns this tick.
  acquireLease(job: string, ttlSeconds: number, holder: string): Promise<LeaseAcquisition>;
  // Persist a successful completion (moves last_success_at).
  recordSuccess(job: string): Promise<void>;
  track(event: string, properties?: Record<string, unknown>): void;
  logger: SchedulerLogger;
  // Stable per-process holder id (debugging: which replica holds a lease).
  holder: string;
  now: () => number;
}

export interface SchedulerHandle {
  start(): void;
  stop(): void;
}

export function createScheduler(deps: SchedulerDeps): SchedulerHandle {
  const timers: ReturnType<typeof setInterval>[] = [];

  const runJob = async (job: SchedulerJob): Promise<void> => {
    try {
      const { acquired, lastSuccessAt } = await deps.acquireLease(
        job.name,
        job.leaseTtlSeconds,
        deps.holder,
      );
      if (!acquired) {
        deps.logger.info(`[scheduler] ${job.name}: lease busy, skipping tick`, {
          holder: deps.holder,
        });
        return;
      }
      // Due-check against the PERSISTED last success: a restart resets
      // nothing — the job still fires when the gap has elapsed (or never
      // ran: first run at startup / catch-up after downtime).
      const last = lastSuccessAt === null ? null : lastSuccessAt.getTime();
      if (last !== null && deps.now() - last < job.dueAfterMs) {
        deps.logger.info(`[scheduler] ${job.name}: not due yet`, {
          lastSuccessAt: lastSuccessAt!.toISOString(),
          dueAfterMs: job.dueAfterMs,
        });
        return;
      }
      await job.run();
      // Record success BEFORE announcing it: a crash between run() and
      // this line loses the record and the next tick re-runs (idempotent
      // collectors), never the reverse.
      await deps.recordSuccess(job.name);
      // Same event name + property shape ({ route, status }) the
      // /api/cron route's withApiErrorReporting success path emitted.
      deps.track(job.successEvent, { route: job.routeLabel, status: 200 });
    } catch (error) {
      // A failing job must never kill the scheduler: log, report, and
      // let the next tick try again. logger.error reports the scrubbed
      // $exception to PostHog (lib/logger.ts reportErrorToPostHog →
      // scrubSecrets); never capture the raw error here — posthog-node's
      // captureException would send unscrubbed messages/stacks.
      deps.logger.error(`[scheduler] ${job.name}: run failed`, error, {});
    }
  };

  const tick = (): Promise<unknown[]> =>
    Promise.all(deps.jobs.map((job) => runJob(job)));

  return {
    start(): void {
      deps.track('scheduler_started', {
        jobs: deps.jobs.map((job) => ({
          name: job.name,
          dueAfterMs: job.dueAfterMs,
          leaseTtlSeconds: job.leaseTtlSeconds,
        })),
        holder: deps.holder,
        startedAt: new Date(deps.now()).toISOString(),
      });
      // First tick immediately (startup first-run / catch-up), then the
      // frequent due-check tick. The lease + try/catch wrap makes the
      // unawaited tick safe: failures are contained, the interval survives.
      void tick();
      timers.push(setInterval(() => void tick(), deps.tickMs));
    },
    stop(): void {
      for (const timer of timers) clearInterval(timer);
      timers.length = 0;
    },
  };
}
