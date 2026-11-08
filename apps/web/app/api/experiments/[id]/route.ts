import { NextResponse } from 'next/server';

import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { personaScopeOf } from '@/lib/post-detail';
import { UUID } from '@/lib/metrics/metrics-query';
import { parseResultsWindow } from '@/lib/experiments/requests';
import { loadExperimentResults } from '@/lib/experiments/read';

//---------------
// GET /api/experiments/[id]?window=7d — one experiment, its videos by pair
// and the paired results per provider (lib/experiments/results.ts): wins,
// sign-test p-value and the pending / indicative / clear label.
//
// Service role bypasses RLS: every read filters by the caller's user id; an
// unknown, foreign or out-of-scope experiment is a 404.
//---------------

const ROUTE = 'GET /api/experiments/[id]';

async function getHandler(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.experimentRead, auth.userId);
  if (limited) return limited;

  const window = parseResultsWindow(new URL(request.url).searchParams);
  if (typeof window !== 'string') {
    return apiErrorResponse(400, window.error, { route: ROUTE, code: 'VALIDATION_FAILED' });
  }
  const { id: rawId } = await context.params;
  let id: string;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    return apiErrorResponse(404, 'Experiment not found.', { route: ROUTE });
  }
  if (!UUID.test(id)) return apiErrorResponse(404, 'Experiment not found.', { route: ROUTE });

  const result = await loadExperimentResults(createSupabaseServiceClient(), {
    userId: auth.userId,
    experimentId: id,
    scope: personaScopeOf(auth),
    window,
  });
  if (!result.ok && result.status === 404) return apiErrorResponse(404, 'Experiment not found.', { route: ROUTE });
  if (!result.ok) {
    logger.error('[api/experiments] results read failed', result.cause, { experimentId: id });
    return apiErrorResponse(500, 'Failed to load the experiment.', { route: ROUTE, cause: result.cause });
  }
  return NextResponse.json({ success: true, ...result.value });
}

export const GET = withApiErrorReporting(ROUTE, getHandler, {
  getUserId: resolveReportingUserId,
});
