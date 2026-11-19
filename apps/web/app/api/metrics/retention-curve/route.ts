import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { isScopedApiKey } from '@/lib/api-keys';
import { apiErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { AuthError } from '@/lib/errors';
import { getAuthenticatedClient } from '@/lib/upload/handlers';
import { getYouTubeVideoInfo } from '@/lib/youtube';
import { AnalyticsAuthError, analyticsDate, queryRetentionCurve, videoSnippet } from '@/lib/youtube-analytics';
import { UUID, isProvisional, parseRetentionCurveQuery } from '@/lib/metrics/metrics-query';

const ROUTE = 'GET /api/metrics/retention-curve';

async function getHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.retentionCurve, auth.userId);
  if (limited) return limited;

  const parsed = parseRetentionCurveQuery(new URL(request.url).searchParams);
  if ('error' in parsed) {
    return apiErrorResponse(400, parsed.error, {
      route: ROUTE,
      logMessage: 'Invalid retention curve query.',
      metadata: { detail: parsed.error.slice(0, 200) },
    });
  }

  let lookup = createSupabaseServiceClient()
    .from('post_metrics')
    .select('post_id')
    .eq('user_id', auth.userId)
    .eq('provider', 'youtube')
    .eq('account_id', parsed.account)
    .eq('external_id', parsed.video);
  if (isScopedApiKey(auth)) {
    const personaIds = (auth.personaIds ?? []).filter((id) => UUID.test(id));
    lookup = personaIds.length > 0
      ? lookup.or(`persona_id.in.(${personaIds.join(',')}),persona_id.is.null`)
      : lookup.is('persona_id', null);
  }
  const { data, error } = await lookup.order('collected_at', { ascending: false }).limit(1);
  if (error) {
    logger.error('[api/metrics/retention-curve] ownership lookup failed', error);
    return apiErrorResponse(500, 'Failed to load the video.', { route: ROUTE, cause: error });
  }
  if (!Array.isArray(data) || data.length === 0) {
    return apiErrorResponse(404, 'Video not found.', { route: ROUTE });
  }

  try {
    const client = await getAuthenticatedClient(auth.userId, parsed.account);
    const snippet = videoSnippet(await getYouTubeVideoInfo(client, parsed.video));
    if (snippet.channelId !== parsed.account) {
      logger.warn('[api/metrics/retention-curve] video is not on the account channel', { accountId: parsed.account });
      return apiErrorResponse(404, 'Video not found.', { route: ROUTE });
    }
    const publishedAt = typeof snippet.publishedAt === 'string' ? new Date(snippet.publishedAt) : null;
    if (publishedAt === null || Number.isNaN(publishedAt.getTime())) {
      return apiErrorResponse(404, 'Video not found.', { route: ROUTE });
    }
    const now = new Date();
    const range = { videoId: parsed.video, startDate: analyticsDate(publishedAt), endDate: analyticsDate(now) };
    const result = await queryRetentionCurve(client, range);
    if (result.kind === 'scope_missing') {
      return apiErrorResponse(403, 'Reconnect YouTube to enable retention stats.', {
        route: ROUTE,
        code: 'YOUTUBE_ANALYTICS_SCOPE_MISSING',
      });
    }
    return NextResponse.json({
      success: true,
      points: result.points,
      startDate: range.startDate,
      endDate: range.endDate,
      provisional: isProvisional(range.endDate, now.toISOString()),
    });
  } catch (caught) {
    if (caught instanceof AuthError) {
      return apiErrorResponse(403, 'Reconnect YouTube to enable retention stats.', {
        route: ROUTE,
        code: 'YOUTUBE_RECONNECT_REQUIRED',
      });
    }
    if (caught instanceof Error && caught.message === 'Video not found') {
      return apiErrorResponse(404, 'Video not found.', { route: ROUTE });
    }
    return apiErrorResponse(502, 'YouTube Analytics is unavailable. Try again later.', {
      route: ROUTE,
      code: caught instanceof AnalyticsAuthError ? 'YOUTUBE_ANALYTICS_REJECTED' : 'YOUTUBE_ANALYTICS_UNAVAILABLE',
      cause: caught,
    });
  }
}

export const GET = withApiErrorReporting(ROUTE, getHandler, { getUserId: resolveReportingUserId });
