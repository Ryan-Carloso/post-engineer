import { NextResponse } from 'next/server';
import { isScopedApiKey } from '@/lib/api-keys';
import { apiErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { CreateExperimentBodySchema, parseComparisonWindow } from '@/lib/contracts/experiments';
import { createExperiment } from '@/lib/experiments/create-experiment';
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

const POST_ROUTE = 'POST /api/experiments';

async function postHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.experimentCreate, auth.userId);
  if (limited) return limited;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiErrorResponse(400, 'Invalid JSON payload.', { route: POST_ROUTE, code: ERROR_CODES.VALIDATION_FAILED });
  }
  const parsed = CreateExperimentBodySchema.safeParse(body);
  if (!parsed.success) {
    return apiErrorResponse(400, 'Invalid experiment request.', { route: POST_ROUTE, code: ERROR_CODES.VALIDATION_FAILED });
  }
  if (isScopedApiKey(auth) && !auth.personaIds.includes(parsed.data.personaId)) {
    return apiErrorResponse(403, 'This API key does not have access to this persona.', { route: POST_ROUTE, code: ERROR_CODES.VALIDATION_FAILED });
  }
  const outcome = await createExperiment(createSupabaseServiceClient(), auth.userId, parsed.data);
  if (!outcome.ok) {
    return apiErrorResponse(outcome.status, outcome.error, {
      route: POST_ROUTE,
      code: outcome.status === 402 ? ERROR_CODES.INSUFFICIENT_TOKENS : outcome.status === 404 ? ERROR_CODES.VALIDATION_FAILED : outcome.status === 400 ? ERROR_CODES.VALIDATION_FAILED : ERROR_CODES.INTERNAL_ERROR,
      extra: outcome.need !== undefined ? { need: outcome.need, have: outcome.have ?? 0 } : undefined,
    });
  }
  return NextResponse.json(outcome.value);
}

export const POST = withApiErrorReporting(POST_ROUTE, postHandler, { getUserId: resolveReportingUserId });
