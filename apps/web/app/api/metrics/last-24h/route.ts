import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { isScopedApiKey } from '@/lib/api-keys';
import { apiErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { UUID, parseLast24hQuery } from '@/lib/metrics/metrics-query';
import { fetchLast24h } from '@/lib/metrics/last-24h-fetch';

const ROUTE = 'GET /api/metrics/last-24h';

async function getHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.metrics, auth.userId);
  if (limited) return limited;

  const parsed = parseLast24hQuery(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return apiErrorResponse(400, parsed.error, {
      route: ROUTE,
      logMessage: 'Invalid last-24h metrics query.',
      metadata: { detail: parsed.error.slice(0, 200) },
    });
  }

  try {
    const result = await fetchLast24h(createSupabaseServiceClient(), auth.userId, parsed.query, new Date(), {
      personaIds: isScopedApiKey(auth) ? (auth.personaIds ?? []).filter((id) => UUID.test(id)) : null,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    logger.error('[api/metrics/last-24h] query failed', error);
    return apiErrorResponse(500, 'Failed to load metrics.', { route: ROUTE, cause: error });
  }
}

export const GET = withApiErrorReporting(ROUTE, getHandler, { getUserId: resolveReportingUserId });
