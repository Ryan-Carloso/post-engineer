import { NextResponse } from 'next/server';

import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { attachApiErrorProperties, resolveReportingUserId, withApiErrorReporting } from '@/lib/api-error-reporting';
import { experimentResultsTelemetry } from '@/lib/experiments/results-telemetry';
import type { ExperimentResults } from '@/lib/experiments/results';
import { personaScopeOf } from '@/lib/post-detail';
import { UUID } from '@/lib/metrics/metrics-query';
import { parseExperimentDetailQuery } from '@/lib/experiments/requests';
import { loadExperimentResults } from '@/lib/experiments/read';
import { loadExperimentFacts, loadExperimentTaskIds } from '@/lib/experiments/read';
import { loadLiveExperimentResults } from '@/lib/experiments/live';
import { fetchEnginePostMetricsSource } from '@/lib/engine-tasks';
import { fetchProviderCounters } from '@/lib/metrics/provider-counters';

const ROUTE = 'GET /api/experiments/[id]';

function jsonDetail<T extends { results: ExperimentResults }>(body: T): NextResponse {
  const response = NextResponse.json({ success: true, ...body });
  attachApiErrorProperties(response, experimentResultsTelemetry(body.results));
  return response;
}

async function getHandler(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.experimentRead, auth.userId);
  if (limited) return limited;

  const query = parseExperimentDetailQuery(new URL(request.url).searchParams);
  if ('error' in query) {
    return apiErrorResponse(400, query.error, { route: ROUTE, code: 'VALIDATION_FAILED' });
  }
  if (query.live && query.window === '28d') {
    return apiErrorResponse(400, 'live results are only available for the 24h and 7d windows.', {
      route: ROUTE,
      code: 'VALIDATION_FAILED',
    });
  }
  const { id: rawId } = await context.params;
  let id: string;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    return apiErrorResponse(404, 'Experiment not found.', { route: ROUTE });
  }
  if (!UUID.test(id)) return apiErrorResponse(404, 'Experiment not found.', { route: ROUTE });

  const supabase = createSupabaseServiceClient();
  const scope = personaScopeOf(auth);
  if (query.live) {
    const result = await loadLiveExperimentResults(
      {
        loadFacts: () => loadExperimentFacts(supabase, { userId: auth.userId, experimentId: id, scope, window: query.window }),
        loadTaskIds: () => loadExperimentTaskIds(supabase, { userId: auth.userId, experimentId: id }),
        fetchTaskSource: fetchEnginePostMetricsSource,
        fetchCounters: fetchProviderCounters,
        now: () => new Date(),
      },
      { userId: auth.userId, experimentId: id, window: query.window },
    );
    if (!result.ok && result.status === 404) return apiErrorResponse(404, 'Experiment not found.', { route: ROUTE });
    if (!result.ok) {
      logger.error('[api/experiments] live results read failed', result.cause, { experimentId: id });
      return apiErrorResponse(500, 'Failed to load the experiment.', { route: ROUTE, cause: result.cause });
    }
    return jsonDetail(result.value);
  }

  const result = await loadExperimentResults(supabase, {
    userId: auth.userId,
    experimentId: id,
    scope,
    window: query.window,
  });
  if (!result.ok && result.status === 404) return apiErrorResponse(404, 'Experiment not found.', { route: ROUTE });
  if (!result.ok) {
    logger.error('[api/experiments] results read failed', result.cause, { experimentId: id });
    return apiErrorResponse(500, 'Failed to load the experiment.', { route: ROUTE, cause: result.cause });
  }
  return jsonDetail(result.value);
}

export const GET = withApiErrorReporting(ROUTE, getHandler, {
  getUserId: resolveReportingUserId,
});
