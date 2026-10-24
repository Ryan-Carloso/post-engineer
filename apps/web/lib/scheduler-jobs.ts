import 'server-only';

//---------------
// scheduler-jobs — the real job definitions for the in-app scheduler.
//
// Why the scheduler lives in the WEB app and not the engine: both job
// implementations and the service-role client they need are TS here —
// collectPostMetrics is apps/web/lib/metrics/post-metrics.ts:74 and
// runBillingReconciliation is apps/web/lib/billing/reconcile.ts, both
// driven by createSupabaseServiceClient() (apps/web/lib/supabase/service.ts:32).
// The engine has no TS runtime to host them, so a scheduler there would
// need HTTP calls back into the web app — recreating the /api/cron
// surface this change removes.
//
// The success-event names and the error-handling contract are kept
// identical to the removed /api/cron routes (post_metrics_run,
// billing_reconciled, report.errors logged) so the PostHog dashboards
// keep working across the switch.
//---------------

import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { collectPostMetrics, createPostMetricsStore } from '@/lib/metrics/post-metrics';
import { fetchProviderCounters } from '@/lib/metrics/provider-counters';
import { fetchEnginePostMetricsSource } from '@/lib/engine-tasks';
import { createReconcileStore, runBillingReconciliation } from '@/lib/billing/reconcile';
import { trackApiEvent } from '@/lib/analytics';
import { flushPostHog } from '@/lib/posthog-server';
import { logger } from '@/lib/logger';
import { createScheduler, type SchedulerHandle, type SchedulerJob } from '@/lib/scheduler';
import { tryAcquireSchedulerLease } from '@/lib/scheduler-lease';

//---------------
// Hourly per-video performance snapshots (formerly
// POST /api/cron/post-metrics). Errors are logged inside, mirroring the
// route; the summary carries the counts for the success event.
//---------------
async function runPostMetricsTick(): Promise<Record<string, unknown>> {
  const store = createPostMetricsStore(createSupabaseServiceClient());
  const report = await collectPostMetrics({
    ...store,
    fetchTaskSource: fetchEnginePostMetricsSource,
    fetchCounters: fetchProviderCounters,
    track: trackApiEvent,
    now: () => new Date(),
  });
  if (report.errors.length > 0) {
    logger.error('[scheduler/post-metrics] completed with errors', null, {
      errors: report.errors,
    });
  }
  // Long-lived process: a flush is still cheap insurance for the events
  // queued by this tick.
  await flushPostHog();
  return { success: true, errors: report.errors.length };
}

//---------------
// Daily billing reconciliation (formerly POST /api/cron/billing-reconcile):
// zombie auto-refunds and stuck-generation reconciliation. Fully
// automatic — every refund emits `refund_issued` as the audit trail.
//---------------
async function runBillingReconcileTick(): Promise<Record<string, unknown>> {
  const store = createReconcileStore(createSupabaseServiceClient());
  const report = await runBillingReconciliation(store);
  if (report.errors.length > 0) {
    logger.error('[scheduler/billing-reconcile] completed with errors', null, {
      errors: report.errors,
    });
  }
  return { success: true, errors: report.errors.length };
}

export const SCHEDULER_JOBS: SchedulerJob[] = [
  {
    name: 'post-metrics',
    intervalMs: 60 * 60 * 1000, // hourly
    // TTL >> worst-case runtime: a crashed replica's stale lease expires
    // instead of blocking the job forever.
    leaseTtlSeconds: 30 * 60,
    successEvent: 'post_metrics_run',
    run: runPostMetricsTick,
  },
  {
    name: 'billing-reconcile',
    intervalMs: 24 * 60 * 60 * 1000, // daily
    leaseTtlSeconds: 30 * 60,
    successEvent: 'billing_reconciled',
    run: runBillingReconcileTick,
  },
];

//---------------
// SCHEDULER_ENABLED=false turns the whole scheduler off (dev, tests,
// CI). Tests are also auto-disabled: vitest runs register() never (no
// Next server), but a stray import must not start timers either.
//---------------
export function isSchedulerEnabled(): boolean {
  if (process.env.NODE_ENV === 'test') return false;
  return process.env.SCHEDULER_ENABLED !== 'false';
}

//---------------
// startInternalScheduler — build the scheduler with real dependencies and
// start it. Returns null when disabled (dev/tests/CI via
// SCHEDULER_ENABLED=false). Errors building the service client (missing
// env in a misconfigured deploy) surface as a loud log, not a crash.
//---------------
export function startInternalScheduler(): SchedulerHandle | null {
  if (!isSchedulerEnabled()) return null;
  const handle = createScheduler({
    jobs: SCHEDULER_JOBS,
    acquireLease: tryAcquireSchedulerLease,
    track: trackApiEvent,
    logger,
    holder: `${process.env.HOSTNAME ?? 'web'}:${process.pid}`,
    now: () => Date.now(),
  });
  handle.start();
  logger.info('[scheduler] started', {
    jobs: SCHEDULER_JOBS.map((job) => job.name),
  });
  return handle;
}
