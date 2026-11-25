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
import { confirmExperiment } from './create-confirm';
import { parseExperimentRequest } from './create-plan';
import { quoteExperiment } from './create-quote';

const ROUTE = 'GET /api/experiments';
const POST_ROUTE = 'POST /api/experiments';

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

async function postHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.experimentCreate, auth.userId);
  if (limited) return limited;
  const body = await parseExperimentRequest(request);
  if (body instanceof NextResponse) return body;
  const supabase = createSupabaseServiceClient();
  return body.quoteKey === undefined
    ? quoteExperiment(supabase, auth, body, new Date())
    : confirmExperiment(supabase, auth, body, new Date());
}

export const GET = withApiErrorReporting(ROUTE, getHandler, { getUserId: resolveReportingUserId });
export const POST = withApiErrorReporting(POST_ROUTE, postHandler, { getUserId: resolveReportingUserId });
