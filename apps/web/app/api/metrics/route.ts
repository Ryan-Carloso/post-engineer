import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { isScopedApiKey } from '@/lib/api-keys';
import { apiErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { isSocialProvider } from '@/lib/providers/registry';
import {
  METRICS_NONE,
  METRICS_ROW_LIMIT,
  UUID,
  isAnalyticsStatus,
  isProvisional,
  numericOrNull,
  parseMetricsQuery,
  stayedToWatchPct,
  type CoverageItem,
  type MetricsRowView,
} from '@/lib/metrics/metrics-query';
import { fetchCoverage } from '@/lib/metrics/metrics-coverage';

async function getHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.metrics, auth.userId);
  if (limited) return limited;

  const parsed = parseMetricsQuery(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return apiErrorResponse(400, parsed.error, {
      route: 'GET /api/metrics',
      logMessage: 'Invalid metrics query.',
      metadata: { detail: parsed.error.slice(0, 200) },
    });
  }
  const { query } = parsed;

  const supabase = createSupabaseServiceClient();
  let select = supabase
    .from('post_metrics')
    .select(
      'post_id, persona_id, provider, account_id, external_id, views, likes, comments, saves, collected_at, analytics_status, analytics_views, engaged_views, average_view_duration_seconds, average_view_percentage, content_type, analytics_end_date',
    )
    .eq('user_id', auth.userId)
    .eq('metrics_window', query.window);

  if (isScopedApiKey(auth)) {
    const personaIds = (auth.personaIds ?? []).filter((id) => UUID.test(id));
    select = personaIds.length > 0
      ? select.or(`persona_id.in.(${personaIds.join(',')}),persona_id.is.null`)
      : select.is('persona_id', null);
  }
  if (query.personaId === METRICS_NONE) select = select.is('persona_id', null);
  else if (query.personaId !== null) select = select.eq('persona_id', query.personaId);
  if (query.accountId !== null) select = select.eq('account_id', query.accountId);
  if (query.provider !== null) select = select.eq('provider', query.provider);

  const { data, error } = await select
    .order('collected_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(METRICS_ROW_LIMIT + 1);
  if (error) {
    logger.error('[api/metrics] query failed', error);
    return apiErrorResponse(500, 'Failed to load metrics.', { route: 'GET /api/metrics', cause: error });
  }

  const records = Array.isArray(data) ? data : [];
  const publishDateByPostId = new Map<string, string>();
  {
    const postIds = [...new Set(
      records.slice(0, METRICS_ROW_LIMIT).map((record) => record.post_id),
    )];
    if (postIds.length > 0) {
      const { data: postData, error: postError } = await supabase
        .from('scheduled_posts')
        .select('id, published_at')
        .eq('user_id', auth.userId)
        .in('id', postIds)
        .limit(METRICS_ROW_LIMIT);
      if (postError) {
        logger.error('[api/metrics] publish-date lookup failed', postError);
        return apiErrorResponse(500, 'Failed to load metrics.', { route: 'GET /api/metrics', cause: postError });
      }
      const postRecords = Array.isArray(postData) ? postData : [];
      for (const record of postRecords) {
        if (typeof record.id === 'string' && typeof record.published_at === 'string') {
          publishDateByPostId.set(record.id, record.published_at);
        }
      }
    }
  }
  const rows: MetricsRowView[] = [];
  for (const record of records.slice(0, METRICS_ROW_LIMIT)) {
    if (!isSocialProvider(record.provider)) {
      logger.warn('[api/metrics] skipped row with unknown provider', { provider: record.provider });
      continue;
    }
    const publishedAt = publishDateByPostId.get(record.post_id);
    if (publishedAt === undefined) {
      const error = new Error(`publish date missing for post ${record.post_id}`);
      logger.error('[api/metrics] publish-date lookup failed', error);
      return apiErrorResponse(500, 'Failed to load metrics.', { route: 'GET /api/metrics', cause: error });
    }
    rows.push({
      postId: record.post_id,
      personaId: record.persona_id,
      provider: record.provider,
      accountId: record.account_id,
      externalId: record.external_id,
      publishedAt,
      views: record.views,
      likes: record.likes,
      comments: record.comments,
      saves: record.saves,
      analyticsViews: record.analytics_views,
      engagedViews: record.engaged_views,
      stayedToWatchPct: stayedToWatchPct(record.engaged_views, record.analytics_views),
      averageViewDurationSeconds: numericOrNull(record.average_view_duration_seconds),
      averageViewPercentage: numericOrNull(record.average_view_percentage),
      contentType: record.content_type,
      analyticsStatus: isAnalyticsStatus(record.analytics_status) ? record.analytics_status : null,
      provisional: isProvisional(record.analytics_end_date, record.collected_at),
      collectedAt: record.collected_at,
    });
  }
  let coverage: CoverageItem[] = [];
  let coverageTruncated = false;
  try {
    const found = await fetchCoverage(supabase, auth.userId, query, new Date(), {
      personaIds: isScopedApiKey(auth) ? (auth.personaIds ?? []).filter((id) => UUID.test(id)) : null,
    });
    coverage = found.items;
    coverageTruncated = found.truncated;
  } catch (error) {
    logger.error('[api/metrics] coverage lookup failed', error);
  }

  return NextResponse.json({
    success: true,
    rows,
    truncated: records.length > METRICS_ROW_LIMIT,
    coverage,
    coverageTruncated,
    asOf: rows.reduce<string | null>(
      (max, row) => (max === null || row.collectedAt > max ? row.collectedAt : max),
      null,
    ),
  });
}

export const GET = withApiErrorReporting('GET /api/metrics', getHandler, { getUserId: resolveReportingUserId });
