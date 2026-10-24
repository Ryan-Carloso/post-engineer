//---------------
// scheduler — the in-process scheduler core.
//
// Replaces the pg_cron + pg_net HTTP triggering of /api/cron/*: the jobs
// now run INSIDE the web app (no public HTTP route, no CRON_SECRET, no
// pg_cron), on setInterval timers started once per server process from
// instrumentation.ts's register().
//
// Multi-replica safety: every tick first tries to acquire a database
// lease (supabase/migrations/027_internal-scheduler.sql,
// try_acquire_scheduler_lease). With several app replicas running, only
// the replica that wins the lease executes the job in that tick; the
// others skip. A replica that crashes mid-run keeps the lease until the
// TTL expires, so at most one job runs at a time and nothing double-runs
// per tick.
//
// Fault isolation: a job that throws is logged and reported to PostHog,
// but the timer survives — the next tick runs normally.
//
// This module is dependency-injected (jobs, lease, tracking, timers) so
// tests can drive ticks with fake timers and mocks; lib/scheduler-jobs.ts
// wires the real implementations, and lib/__tests__/scheduler.test.ts
// pins tick / lease-busy / error-survival behavior.
//
// The global timers are used (not node:timers) so vitest's fake timers
// can intercept them in tests.
//---------------

export interface SchedulerJob {
  // Stable job name; doubles as the lease key.
  name: string;
  // Time between ticks.
  intervalMs: number;
  // Lease TTL: must comfortably exceed the job's worst-case runtime so a
  // slow run never lets a second replica start a duplicate.
  leaseTtlSeconds: number;
  // PostHog event emitted after a successful run (kept identical to the
  // former /api/cron route telemetry: 'post_metrics_run' and
  // 'billing_reconciled' — see lib/api-telemetry-names.ts history).
  successEvent: string;
  // The job itself. Resolves with a summary for the success event.
  run: () => Promise<Record<string, unknown>>;
}

export interface SchedulerLogger {
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, error: unknown, context?: Record<string, unknown>): void;
}

export interface SchedulerDeps {
  jobs: SchedulerJob[];
  // Acquire the DB lease for one tick. False = another replica owns it.
  acquireLease(job: string, ttlSeconds: number, holder: string): Promise<boolean>;
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
      const acquired = await deps.acquireLease(job.name, job.leaseTtlSeconds, deps.holder);
      if (!acquired) {
        deps.logger.info(`[scheduler] ${job.name}: lease busy, skipping tick`, {
          holder: deps.holder,
        });
        return;
      }
      const summary = await job.run();
      // Kept from the /api/cron routes: one success event per completed
      // run (report.errors are carried as properties; the errors were
      // logged inside the job, and a completed run is still a success —
      // same as the former 200-with-report response).
      deps.track(job.successEvent, { job: job.name, ...summary });
    } catch (error) {
      // A failing job must never kill the scheduler: log, report, and
      // let the next tick try again. logger.error reports the scrubbed
      // $exception to PostHog (lib/logger.ts reportErrorToPostHog →
      // scrubSecrets); never capture the raw error here — posthog-node's
      // captureException would send unscrubbed messages/stacks.
      deps.logger.error(`[scheduler] ${job.name}: run failed`, error, {});
    }
  };

  return {
    start(): void {
      for (const job of deps.jobs) {
        // The lease + try/catch wrap makes the tick safe to fire unawaited:
        // failures are contained and the interval survives.
        timers.push(setInterval(() => void runJob(job), job.intervalMs));
      }
      deps.track('scheduler_started', {
        jobs: deps.jobs.map((job) => ({
          name: job.name,
          intervalMs: job.intervalMs,
          leaseTtlSeconds: job.leaseTtlSeconds,
        })),
        holder: deps.holder,
        startedAt: new Date(deps.now()).toISOString(),
      });
    },
    stop(): void {
      for (const timer of timers) clearInterval(timer);
      timers.length = 0;
    },
  };
}
