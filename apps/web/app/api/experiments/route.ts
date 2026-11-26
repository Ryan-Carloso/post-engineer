import { NextResponse } from 'next/server';
import { isScopedApiKey } from '@/lib/api-keys';
import { apiErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { parseComparisonWindow } from '@/lib/contracts/experiments';
import { UUID } from '@/lib/contracts/metrics';
import { ERROR_CODES } from '@/lib/error-codes';
import { readPromptComparison } from '@/lib/experiments/read-comparison';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

const ROUTE = 'GET /api/experiments';

async function getHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.experimentRead, auth.userId);
  if (limited) return limited;
  const window = parseComparisonWindow(new URL(request.url).searchParams);
  if (typeof window !== 'string') {
    return apiErrorResponse(400, window.error, { route: ROUTE, code: ERROR_CODES.VALIDATION_FAILED });
  }
  const personaIds = isScopedApiKey(auth) ? auth.personaIds.filter((id) => UUID.test(id)) : null;
  const outcome = await readPromptComparison(createSupabaseServiceClient(), { userId: auth.userId, window, personaIds });
  if (!outcome.ok) {
    return apiErrorResponse(500, 'Failed to load the prompt comparison.', {
      route: ROUTE,
      code: ERROR_CODES.INTERNAL_ERROR,
      cause: outcome.cause,
    });
  }
  return NextResponse.json({ success: true, ...outcome.value });
}

export const GET = withApiErrorReporting(ROUTE, getHandler, { getUserId: resolveReportingUserId });
