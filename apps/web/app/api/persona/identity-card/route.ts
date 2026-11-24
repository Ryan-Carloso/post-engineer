import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { isPersonaAllowed } from '@/lib/api-keys';
import { applyRateLimit, CALLER_RATE_LIMITS, profileForCaller } from '@/lib/rate-limit';
import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES } from '@/lib/error-codes';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { parsePersonaIdQuery } from '@/lib/contracts/personas';
import { isUuid } from '@/lib/schedule-slot-id';
import {
  IDENTITY_CARD_MISSING_CODE,
  IDENTITY_CARD_VERSION,
  SCENE_MAX_BYTES,
  parseIdentityCardValue,
  parseSceneValue,
  type IdentityCard,
} from '@/lib/contracts/persona-identity-card';
import { readBoundedText } from '@/lib/oauth/dcr-limits';
import { buildIdentityPrompt } from '@/lib/persona-identity-prompt';

const GET_ROUTE = 'GET /api/persona/identity-card';
const POST_ROUTE = 'POST /api/persona/identity-card';
const BODY_MAX_BYTES = SCENE_MAX_BYTES + 1024;

interface Caller {
  userId: string;
  supabase: SupabaseClient;
}

function validationError(route: string, message: string, field: string): NextResponse {
  return apiErrorResponse(400, message, { route, code: ERROR_CODES.VALIDATION_FAILED, field });
}

async function authenticate(request: Request, route: string): Promise<{ caller: Caller; personaIds: string[] | null } | NextResponse> {
  const session = await requireSupabaseSession(request);
  if (session.error || !session.auth) {
    return session.error ?? apiErrorResponse(401, 'Authentication required.', { route });
  }
  const auth = session.auth;
  const limited = await applyRateLimit(request, profileForCaller(auth, CALLER_RATE_LIMITS.personaIdentityCard), auth.userId);
  if (limited) return limited;
  const supabase =
    auth.isApiKey === true || auth.isOAuth === true
      ? createSupabaseServiceClient()
      : await createSupabaseServerClient();
  return { caller: { userId: auth.userId, supabase }, personaIds: auth.personaIds ?? null };
}

function denyScope(route: string): NextResponse {
  return apiErrorResponse(403, 'This API key cannot access this persona.', {
    route,
    code: ERROR_CODES.PERSONA_SCOPE_DENIED,
    field: 'personaId',
  });
}

async function loadStoredCard(
  caller: Caller,
  personaId: string,
  route: string,
): Promise<{ card: IdentityCard | null } | NextResponse> {
  const { data, error } = await caller.supabase
    .from('personas')
    .select('id, identity_card')
    .eq('id', personaId)
    .eq('user_id', caller.userId)
    .single();
  if (error) {
    if (error.code === 'PGRST116') {
      return apiErrorResponse(404, 'Persona not found.', { route, code: ERROR_CODES.PERSONA_NOT_FOUND, field: 'personaId' });
    }
    logger.error('[api/persona/identity-card] persona lookup failed', { personaId, code: error.code });
    return apiErrorResponse(500, 'Failed to load persona.', { route, code: ERROR_CODES.INTERNAL_ERROR });
  }
  if (data === null) {
    return apiErrorResponse(404, 'Persona not found.', { route, code: ERROR_CODES.PERSONA_NOT_FOUND, field: 'personaId' });
  }
  const stored: unknown = data.identity_card;
  if (stored === null || stored === undefined) return { card: null };
  const parsed = parseIdentityCardValue(stored, 'identity_card');
  if (!parsed.ok) {
    logger.error('[api/persona/identity-card] stored card failed validation', { personaId, problem: parsed.error });
    return apiErrorResponse(500, 'The stored identity card is invalid.', { route, code: ERROR_CODES.INTERNAL_ERROR });
  }
  return { card: parsed.value };
}

async function getHandler(request: Request): Promise<NextResponse> {
  const authenticated = await authenticate(request, GET_ROUTE);
  if (authenticated instanceof NextResponse) return authenticated;
  const parsed = parsePersonaIdQuery(request.url);
  if (!parsed.ok) return validationError(GET_ROUTE, parsed.error, 'personaId');
  const personaId = parsed.query.personaId;
  if (!isUuid(personaId)) {
    return validationError(GET_ROUTE, 'personaId must be a UUID.', 'personaId');
  }
  if (!isPersonaAllowed(authenticated.personaIds, personaId)) return denyScope(GET_ROUTE);

  const loaded = await loadStoredCard(authenticated.caller, personaId, GET_ROUTE);
  if (loaded instanceof NextResponse) return loaded;
  return NextResponse.json({ success: true, identityCard: loaded.card });
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

async function postHandler(request: Request): Promise<NextResponse> {
  const authenticated = await authenticate(request, POST_ROUTE);
  if (authenticated instanceof NextResponse) return authenticated;

  const text = await readBoundedText(request, BODY_MAX_BYTES);
  if (!text.ok) return validationError(POST_ROUTE, `body: at most ${BODY_MAX_BYTES} bytes`, 'scene');
  let body: unknown;
  try {
    body = JSON.parse(text.text);
  } catch {
    return validationError(POST_ROUTE, 'Request body must be valid JSON.', 'scene');
  }
  const fields = recordOf(body);
  if (fields === null) return validationError(POST_ROUTE, 'Request body must be a JSON object.', 'scene');
  const personaId = fields.personaId;
  if (typeof personaId !== 'string' || personaId.length === 0) {
    return validationError(POST_ROUTE, 'personaId is required.', 'personaId');
  }
  if (!isUuid(personaId)) {
    return validationError(POST_ROUTE, 'personaId must be a UUID.', 'personaId');
  }
  if (!isPersonaAllowed(authenticated.personaIds, personaId)) return denyScope(POST_ROUTE);
  if (Object.keys(fields).some((key) => key !== 'personaId' && key !== 'scene')) {
    return validationError(POST_ROUTE, 'body: unknown field', 'scene');
  }
  if (fields.scene === undefined) return validationError(POST_ROUTE, 'scene: required', 'scene');

  const sceneJson = JSON.stringify(fields.scene);
  if (new TextEncoder().encode(sceneJson).length > SCENE_MAX_BYTES) {
    return validationError(POST_ROUTE, `scene: at most ${SCENE_MAX_BYTES} bytes`, 'scene');
  }
  const scene = parseSceneValue(fields.scene);
  if (!scene.ok) return validationError(POST_ROUTE, scene.error, 'scene');

  const loaded = await loadStoredCard(authenticated.caller, personaId, POST_ROUTE);
  if (loaded instanceof NextResponse) return loaded;
  if (loaded.card === null) {
    return apiErrorResponse(
      409,
      'This persona has no identity card. Set one with personas (action: update, identityCard) first.',
      { route: POST_ROUTE, code: IDENTITY_CARD_MISSING_CODE, field: 'personaId' },
    );
  }
  const rendered = buildIdentityPrompt(loaded.card, scene.value);
  return NextResponse.json({
    success: true,
    prompt: rendered.prompt,
    suggestedDescription: rendered.suggestedDescription,
    cardVersion: IDENTITY_CARD_VERSION,
  });
}

export const GET = withApiErrorReporting(GET_ROUTE, getHandler, { getUserId: resolveReportingUserId });
export const POST = withApiErrorReporting(POST_ROUTE, postHandler, { getUserId: resolveReportingUserId });
