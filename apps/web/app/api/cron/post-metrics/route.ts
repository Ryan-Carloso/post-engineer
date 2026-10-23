//---------------
// POST /api/cron/post-metrics — hourly per-video performance snapshots.
//
// Called by the pg_cron job (supabase/migrations/025_post-metrics.sql) with
// `Authorization: Bearer <CRON_SECRET>`. Snapshots views/likes/comments/
// saves of every published video 24h and 7d after publish into
// post_metrics, and emits post_metrics_collected to PostHog. Not
// user-facing: no rate limit, no session — the shared secret is the only
// gate.
//
// Service-role bypasses RLS: every row read comes from
// find_post_metrics_due (owner user_id included) and every token lookup is
// scoped to that owner.
//---------------

import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { collectPostMetrics, createPostMetricsStore } from '@/lib/metrics/post-metrics';
import { fetchProviderCounters } from '@/lib/metrics/provider-counters';
import { fetchEnginePostMetricsSource } from '@/lib/engine-tasks';
import { trackApiEvent } from '@/lib/analytics';
import { flushPostHog } from '@/lib/posthog-server';
import { logger } from '@/lib/logger';
import { withApiErrorReporting } from '@/lib/api-error-reporting';
import { rejectUnauthorizedCron } from '@/lib/cron-auth';

async function postHandler(request: Request): Promise<NextResponse> {
  const rejection = rejectUnauthorizedCron(request, 'cron/post-metrics', 'Post metrics are not configured.');
  if (rejection !== null) return rejection;

  const store = createPostMetricsStore(createSupabaseServiceClient());
  const report = await collectPostMetrics({
    ...store,
    fetchTaskSource: fetchEnginePostMetricsSource,
    fetchCounters: fetchProviderCounters,
    track: trackApiEvent,
    now: () => new Date(),
  });
  if (report.errors.length > 0) {
    logger.error('[cron/post-metrics] completed with errors', null, { errors: report.errors });
  }
  // Serverless: queued PostHog events would be lost when the function ends.
  await flushPostHog();
  return NextResponse.json({ success: true, report });
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const POST = withApiErrorReporting('POST /api/cron/post-metrics', postHandler);
