import { NextResponse } from 'next/server';

import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { isPersonaAllowed } from '@/lib/api-keys';
import { apiErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { personaScopeOf } from '@/lib/post-detail';
import { CreateExperimentSchema } from '@/lib/experiments/requests';
import { listExperiments } from '@/lib/experiments/read';

//---------------
// /api/experiments — paired content A/B tests (issue #476).
//
// POST creates an experiment and its two variants in one transaction
// (create_experiment RPC). Videos join it later through
// POST /api/videos/generate-and-schedule with `experiment: { experimentId,
// variantId, pair }`, which checks pair fairness before charging.
// GET lists the caller's experiments.
//
// Service role bypasses RLS: ownership is the explicit user id passed to
// the RPC and the user_id filter on every read; a persona-scoped API key
// may only create and see experiments of its personas (or persona-less).
//---------------

const ROUTE_POST = 'POST /api/experiments';

async function postHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.experimentCreate, auth.userId);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiErrorResponse(400, 'Invalid JSON payload.', { route: ROUTE_POST, code: 'VALIDATION_FAILED' });
  }
  const parsed = CreateExperimentSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue.path.join('.');
    return apiErrorResponse(400, `Invalid request: ${field.length > 0 ? `${field}: ` : ''}${issue.message}`.slice(0, 500), {
      route: ROUTE_POST,
      code: 'VALIDATION_FAILED',
      logMessage: 'Invalid experiment request.',
      extra: { field: field.slice(0, 200) },
    });
  }
  const input = parsed.data;
  const personaId = input.personaId ?? null;
  const supabase = createSupabaseServiceClient();

  if (personaId !== null) {
    if (!isPersonaAllowed(personaScopeOf(auth), personaId)) {
      return apiErrorResponse(403, 'This API key cannot access the selected persona.', { route: ROUTE_POST, code: 'PERSONA_SCOPE_DENIED' });
    }
    const { data: persona, error: personaError } = await supabase
      .from('personas')
      .select('id')
      .eq('id', personaId)
      .eq('user_id', auth.userId)
      .maybeSingle();
    if (personaError) {
      logger.error('[api/experiments] persona lookup failed', personaError, { personaId });
      return apiErrorResponse(500, 'Failed to create the experiment.', { route: ROUTE_POST, cause: personaError });
    }
    if (persona === null) return apiErrorResponse(404, 'Persona not found.', { route: ROUTE_POST, code: 'PERSONA_NOT_FOUND' });
  }

  const { data: experimentId, error } = await supabase.rpc('create_experiment', {
    p_user_id: auth.userId,
    p_name: input.name,
    p_variable: input.variable,
    p_persona_id: personaId,
    p_target_pairs: input.targetPairs,
    p_variants: input.variants.map((variant) => ({
      variant_id: variant.variantId,
      name: variant.name,
      description: variant.description,
    })),
  });
  if (error || typeof experimentId !== 'string') {
    logger.error('[api/experiments] create_experiment failed', error, { userId: auth.userId });
    return apiErrorResponse(500, 'Failed to create the experiment.', { route: ROUTE_POST, cause: error });
  }
  return NextResponse.json({
    success: true,
    experiment: {
      id: experimentId,
      name: input.name,
      variable: input.variable,
      personaId,
      targetPairs: input.targetPairs,
      variants: input.variants,
    },
  });
}

async function getHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.experimentRead, auth.userId);
  if (limited) return limited;
  if ([...new URL(request.url).searchParams.keys()].length > 0) {
    return apiErrorResponse(400, 'Unknown query parameter.', { route: 'GET /api/experiments', code: 'VALIDATION_FAILED' });
  }
  const result = await listExperiments(createSupabaseServiceClient(), auth.userId, personaScopeOf(auth));
  if (!result.ok) {
    logger.error('[api/experiments] list failed', result.cause);
    return apiErrorResponse(500, 'Failed to load experiments.', { route: 'GET /api/experiments', cause: result.cause });
  }
  return NextResponse.json({ success: true, ...result.value });
}

export const POST = withApiErrorReporting(ROUTE_POST, postHandler, { getUserId: resolveReportingUserId });
export const GET = withApiErrorReporting('GET /api/experiments', getHandler, { getUserId: resolveReportingUserId });
