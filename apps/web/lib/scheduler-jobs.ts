import 'server-only';

import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { collectPostMetrics, createPostMetricsStore } from '@/lib/metrics/post-metrics';
import { fetchProviderCounters } from '@/lib/metrics/provider-counters';
import { resolveYouTubeMetricsTarget } from '@/lib/metrics/youtube-account-resolution';
import { fetchEnginePostMetricsSource } from '@/lib/engine-tasks';
import { createReconcileStore, runBillingReconciliation } from '@/lib/billing/reconcile';
import { trackApiEvent } from '@/lib/analytics';
import { flushPostHog } from '@/lib/posthog-server';
import { logger } from '@/lib/logger';
import { createScheduler, type SchedulerHandle, type SchedulerJob } from '@/lib/scheduler';
import {
  createSupabaseVideoUploadStorage,
  createSupabaseVideoUploadStore,
  sweepExpiredVideoUploads,
} from '@/lib/videos/signed-upload';
import { InstagramService } from '@/lib/instagram';
import { refreshThreadsToken } from '@/lib/threads';
import { isUnauthorizedError } from '@/lib/account-break';
import { notifyAccountBreak } from '@/lib/owner-alert-mail';
import { refreshExpiringSocialTokens } from '@/lib/social-token-refresh';
import { createTokenRefreshStore } from '@/lib/social-token-refresh-store';
import {
  getSchedulerLastSuccess,
  recordSchedulerSuccess,
  tryAcquireSchedulerLease,
} from '@/lib/scheduler-lease';

async function runPostMetricsTick(): Promise<void> {
  const store = createPostMetricsStore(createSupabaseServiceClient());
  const report = await collectPostMetrics({
    ...store,
    fetchTaskSource: fetchEnginePostMetricsSource,
    fetchCounters: fetchProviderCounters,
    resolveTarget: resolveYouTubeMetricsTarget,
    track: trackApiEvent,
    now: () => new Date(),
  });
  if (report.errors.length > 0) {
    logger.error('[scheduler/post-metrics] completed with errors', null, {
      errors: report.errors,
    });
  }
  await flushPostHog();
}

async function runBillingReconcileTick(): Promise<void> {
  const store = createReconcileStore(createSupabaseServiceClient());
  const report = await runBillingReconciliation(store);
  if (report.errors.length > 0) {
    logger.error('[scheduler/billing-reconcile] completed with errors', null, {
      errors: report.errors,
    });
  }
  await flushPostHog();
}

async function runVideoUploadSweepTick(): Promise<void> {
  const removed = await sweepExpiredVideoUploads(
    createSupabaseVideoUploadStore(),
    createSupabaseVideoUploadStorage(),
    new Date(),
  );
  if (removed > 0) {
    logger.info('[scheduler/video-upload-sweep] removed expired uploads', { removed });
  }
}

async function runSocialTokenRefreshTick(): Promise<void> {
  const report = await refreshExpiringSocialTokens({
    store: createTokenRefreshStore(createSupabaseServiceClient()),
    refreshers: {
      instagram: async (accessToken) => {
        const token = await new InstagramService().refreshLongLivedToken(accessToken);
        return { accessToken: token.accessToken, expiresInSeconds: token.expiresIn };
      },
      threads: async (accessToken) => {
        const token = await refreshThreadsToken(accessToken);
        return { accessToken: token.access_token, expiresInSeconds: token.expires_in };
      },
    },
    isUnauthorized: isUnauthorizedError,
    reportBroken: (candidate, error) => {
      void notifyAccountBreak({
        userId: candidate.userId,
        provider: candidate.provider,
        accountId: candidate.providerAccountId,
        socialAccountId: candidate.id,
        error,
      }).catch((notifyError: unknown) => {
        logger.error('[scheduler/social-token-refresh] owner alert failed', notifyError);
      });
    },
    track: trackApiEvent,
    logger,
    now: () => new Date(),
  });
  logger.info('[scheduler/social-token-refresh] completed', { ...report });
  await flushPostHog();
}

export const SCHEDULER_TICK_MS = 60 * 60 * 1000;

export const SCHEDULER_JOBS: SchedulerJob[] = [
  {
    name: 'post-metrics',
    dueAfterMs: 60 * 60 * 1000,
    leaseTtlSeconds: 30 * 60,
    successEvent: 'post_metrics_run',
    routeLabel: 'POST /api/cron/post-metrics',
    run: runPostMetricsTick,
  },
  {
    name: 'billing-reconcile',
    dueAfterMs: 24 * 60 * 60 * 1000,
    leaseTtlSeconds: 30 * 60,
    successEvent: 'billing_reconciled',
    routeLabel: 'POST /api/cron/billing-reconcile',
    run: runBillingReconcileTick,
  },
  {
    name: 'video-upload-sweep',
    dueAfterMs: 60 * 60 * 1000,
    leaseTtlSeconds: 5 * 60,
    successEvent: 'video_upload_sweep',
    routeLabel: 'internal:video-upload-sweep',
    run: runVideoUploadSweepTick,
  },
  {
    name: 'social-token-refresh',
    dueAfterMs: 24 * 60 * 60 * 1000,
    leaseTtlSeconds: 30 * 60,
    successEvent: 'social_token_refresh_run',
    routeLabel: 'internal:social-token-refresh',
    run: runSocialTokenRefreshTick,
  },
];

export function isSchedulerEnabled(): boolean {
  const flag = process.env.SCHEDULER_ENABLED;
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

export function startInternalScheduler(): SchedulerHandle | null {
  if (!isSchedulerEnabled()) return null;
  const handle = createScheduler({
    jobs: SCHEDULER_JOBS,
    tickMs: SCHEDULER_TICK_MS,
    acquireLease: async (job, ttlSeconds, holder) => {
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
