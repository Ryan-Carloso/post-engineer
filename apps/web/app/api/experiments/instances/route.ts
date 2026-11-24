import { NextResponse } from 'next/server';
import { isScopedApiKey } from '@/lib/api-keys';
import { apiErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { UUID } from '@/lib/contracts/metrics';
import { ERROR_CODES } from '@/lib/error-codes';
import { cancelExperiment, listExperiments } from '@/lib/experiments/list-experiments';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

const GET_ROUTE = 'GET /api/experiments/instances';
const DELETE_ROUTE = 'DELETE /api/experiments/instances';

async function getHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.experimentRead, auth.userId);
  if (limited) return limited;
  const personaIds = isScopedApiKey(auth) ? auth.personaIds.filter((id) => UUID.test(id)) : null;
  const outcome = await listExperiments(createSupabaseServiceClient(), auth.userId, personaIds);
  if (!outcome.ok) {
    return apiErrorResponse(500, 'Failed to load experiments.', { route: GET_ROUTE, code: ERROR_CODES.INTERNAL_ERROR });
  }
  return NextResponse.json({ success: true, experiments: outcome.value });
}

async function deleteHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.experimentCancel, auth.userId);
  if (limited) return limited;
  const id = new URL(request.url).searchParams.get('id');
  if (id === null || !UUID.test(id)) {
    return apiErrorResponse(404, 'Experiment not found.', { route: DELETE_ROUTE, code: ERROR_CODES.VALIDATION_FAILED });
  }
  const outcome = await cancelExperiment(createSupabaseServiceClient(), auth.userId, id);
  if (!outcome.ok) {
    return apiErrorResponse(outcome.status, outcome.error, {
      route: DELETE_ROUTE,
      code: outcome.status === 404 ? ERROR_CODES.VALIDATION_FAILED : ERROR_CODES.INTERNAL_ERROR,
    });
  }
  return NextResponse.json({ success: true, ...outcome.value });
}

export const GET = withApiErrorReporting(GET_ROUTE, getHandler, { getUserId: resolveReportingUserId });
export const DELETE = withApiErrorReporting(DELETE_ROUTE, deleteHandler, { getUserId: resolveReportingUserId });
