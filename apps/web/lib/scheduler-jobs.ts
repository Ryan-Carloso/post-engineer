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
// surface this change removes. This is a long-lived process (docker
// compose on the VPS: apps/web/docker-compose.yml, deployed by
// .github/workflows/deploy.yml), not serverless, so in-process timers
// persist across ticks.
//
// Restart-safe scheduling: the scheduler does not trust boot-relative
// timers. Every tick checks the job's last SUCCESSFUL run persisted in
// the database (scheduler_leases.last_success_at, migration 027):
// post-metrics is due after >= 1h, billing-reconcile after >= 24h, and a
// job that never ran (fresh deploy or after downtime) runs on the first
// tick at startup. A deploy-restart therefore cannot postpone the daily
// billing run forever.
//
// The success-event names and property shape are kept identical to the
// removed /api/cron routes (post_metrics_run / billing_reconciled with
// { route, status }) so the PostHog dashboards keep working across the
// switch; report.errors are logged inside the jobs, as before.
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
import {
  getSchedulerLastSuccess,
  recordSchedulerSuccess,
  tryAcquireSchedulerLease,
} from '@/lib/scheduler-lease';

//---------------
// Hourly per-video performance snapshots (formerly
// POST /api/cron/post-metrics). Errors are logged inside, mirroring the
// route.
//---------------
async function runPostMetricsTick(): Promise<void> {
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
}

//---------------
// Daily billing reconciliation (formerly POST /api/cron/billing-reconcile):
// zombie auto-refunds and stuck-generation reconciliation. Fully
// automatic — every refund emits `refund_issued` as the audit trail.
//---------------
async function runBillingReconcileTick(): Promise<void> {
  const store = createReconcileStore(createSupabaseServiceClient());
  const report = await runBillingReconciliation(store);
  if (report.errors.length > 0) {
    logger.error('[scheduler/billing-reconcile] completed with errors', null, {
      errors: report.errors,
    });
  }
  // Same flush as the post-metrics tick: insurance for the events
  // queued by this tick (e.g. refund_issued).
  await flushPostHog();
}

export const SCHEDULER_TICK_MS = 60 * 60 * 1000; // hourly due-check tick

export const SCHEDULER_JOBS: SchedulerJob[] = [
  {
    name: 'post-metrics',
    dueAfterMs: 60 * 60 * 1000, // due >= 1h after the last successful run
    // TTL >> worst-case runtime: a crashed replica's stale lease expires
    // instead of blocking the job forever.
    leaseTtlSeconds: 30 * 60,
    successEvent: 'post_metrics_run',
    routeLabel: 'POST /api/cron/post-metrics',
    run: runPostMetricsTick,
  },
  {
    name: 'billing-reconcile',
    dueAfterMs: 24 * 60 * 60 * 1000, // due >= 24h after the last successful run
    leaseTtlSeconds: 30 * 60,
    successEvent: 'billing_reconciled',
    routeLabel: 'POST /api/cron/billing-reconcile',
    run: runBillingReconcileTick,
  },
];

//---------------
// SCHEDULER_ENABLED: on by default ONLY when NODE_ENV=production — in
// dev, tests and CI nothing schedules (no surprise refunds against a
// local database). SCHEDULER_ENABLED=true opts in explicitly anywhere;
// SCHEDULER_ENABLED=false forces off.
//---------------
export function isSchedulerEnabled(): boolean {
  const flag = process.env.SCHEDULER_ENABLED;
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

//---------------
// startInternalScheduler — build the scheduler with real dependencies and
// start it. Returns null when disabled (dev/tests/CI unless
// SCHEDULER_ENABLED=true; false forces off everywhere). Errors building
// the service client (missing env in a misconfigured deploy) surface as
// a loud log, not a crash.
//---------------
export function startInternalScheduler(): SchedulerHandle | null {
  if (!isSchedulerEnabled()) return null;
  const handle = createScheduler({
    jobs: SCHEDULER_JOBS,
    tickMs: SCHEDULER_TICK_MS,
    acquireLease: async (job, ttlSeconds, holder) => {
      // Two RPCs under one lease window: acquire (atomic across
      // replicas), then read the persisted last success. The 30-min
      // lease makes the ordering safe — only the winner reaches here.
      const acquired = await tryAcquireSchedulerLease(job, ttlSeconds, holder);
      const lastSuccessAt = await getSchedulerLastSuccess(job);
      return { acquired, lastSuccessAt };
    },
    recordSuccess: recordSchedulerSuccess,
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
