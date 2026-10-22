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
  parseMetricsQuery,
  type MetricsRowView,
} from '@/lib/metrics/metrics-query';

//---------------
// GET /api/metrics — the caller's per-video snapshots (post_metrics) for
// one window, optionally filtered by persona, account, network and script
// angle. Feeds the metrics dashboard.
//
// Service-role bypasses RLS: ownership is re-checked by the explicit
// user_id filter below, and a persona-scoped API key only sees its
// personas' rows.
//---------------
async function getHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.metrics, auth.userId);
  if (limited) return limited;

  const parsed = parseMetricsQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return apiErrorResponse(400, parsed.error, { route: 'GET /api/metrics' });
  const { query } = parsed;

  const supabase = createSupabaseServiceClient();
  let select = supabase
    .from('post_metrics')
    .select(
      'post_id, persona_id, provider, account_id, external_id, script_angle, views, likes, comments, saves, collected_at',
    )
    // Ownership: service role bypasses RLS.
    .eq('user_id', auth.userId)
    .eq('metrics_window', query.window);

  // Persona-scoped API keys see their personas' rows plus persona-less
  // (faceless) rows — same policy as GET /api/schedule/status: a post
  // with no persona belongs to no persona scope, so it is included like
  // an unrestricted one, otherwise a scoped key could never see metrics
  // for a persona-less post it can already list.
  if (isScopedApiKey(auth)) {
    const personaIds = auth.personaIds ?? [];
    select = personaIds.length > 0
      ? select.or(`persona_id.in.(${personaIds.join(',')}),persona_id.is.null`)
      : select.is('persona_id', null);
  }
  if (query.personaId === METRICS_NONE) select = select.is('persona_id', null);
  else if (query.personaId !== null) select = select.eq('persona_id', query.personaId);
  if (query.accountId !== null) select = select.eq('account_id', query.accountId);
  if (query.provider !== null) select = select.eq('provider', query.provider);
  if (query.angle === METRICS_NONE) select = select.is('script_angle', null);
  else if (query.angle !== null) select = select.eq('script_angle', query.angle);

  const { data, error } = await select
    .order('collected_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(METRICS_ROW_LIMIT + 1);
  if (error) {
    logger.error('[api/metrics] query failed', error);
    return apiErrorResponse(500, 'Failed to load metrics.', { route: 'GET /api/metrics', cause: error });
  }

  const records = Array.isArray(data) ? data : [];
  const rows: MetricsRowView[] = [];
  for (const record of records.slice(0, METRICS_ROW_LIMIT)) {
    if (!isSocialProvider(record.provider)) {
      logger.warn('[api/metrics] skipped row with unknown provider', { provider: record.provider });
      continue;
    }
    rows.push({
      postId: record.post_id,
      personaId: record.persona_id,
      provider: record.provider,
      accountId: record.account_id,
      externalId: record.external_id,
      scriptAngle: record.script_angle,
      views: record.views,
      likes: record.likes,
      comments: record.comments,
      saves: record.saves,
      collectedAt: record.collected_at,
    });
  }
  return NextResponse.json({ success: true, rows, truncated: records.length > METRICS_ROW_LIMIT });
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/metrics', getHandler, { getUserId: resolveReportingUserId });
