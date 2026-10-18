import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { isPersonaAllowed } from '@/lib/api-keys';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES } from '@/lib/error-codes';
import {
  getPersonaDefaultAccounts,
  setPersonaDefaultAccounts,
} from '@/lib/persona-publishing-accounts';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

//---------------
// /api/persona/publishing-accounts?personaId= — per-persona default
// publishing accounts (issue #212, migration 022).
//
// GET returns the persona's defaults grouped per provider; PUT replaces the
// whole set (providers mapped to [] — or omitted — keep no defaults).
// generate-and-schedule falls back to these defaults when
// publishing.accounts is omitted; explicit accounts always win.
//
// Auth = Supabase session (cookie) OR personal API key (Bearer/x-api-key,
// MCP). Ownership is enforced in the lib (service-role callers are
// re-scoped by user_id).
//---------------

const ROUTE = 'GET /api/persona/publishing-accounts';
const PUT_ROUTE = 'PUT /api/persona/publishing-accounts';

function codedError(
  route: string,
  status: number,
  code: string,
  message: string,
  field: string,
): NextResponse {
  const errorCode =
    code === 'PERSONA_NOT_FOUND'
      ? ERROR_CODES.PERSONA_NOT_FOUND
      : code === 'INVALID_PROVIDER_ACCOUNT'
        ? ERROR_CODES.INVALID_PROVIDER_ACCOUNT
        : ERROR_CODES.VALIDATION_FAILED;
  return apiErrorResponse(status, message, { route, code: errorCode, field });
}

function libErrorToResponse(route: string, error: unknown): NextResponse {
  const code = (error as { code?: string } | null)?.code ?? 'UNKNOWN';
  const message = error instanceof Error ? error.message : 'Failed to load publishing accounts.';
  if (code === 'PERSONA_NOT_FOUND') {
    return codedError(route, 404, code, message, 'personaId');
  }
  if (code === 'INVALID_PROVIDER_ACCOUNT') {
    return codedError(route, 400, code, message, 'accounts');
  }
  return codedError(route, 400, 'VALIDATION_FAILED', message, 'accounts');
}

interface RouteContext {
  auth: { userId: string; personaIds?: string[] | null | undefined; isApiKey?: boolean; isOAuth?: boolean };
  supabase: SupabaseClient;
  personaId: string;
}

async function resolveContext(request: Request, route: string): Promise<RouteContext | NextResponse> {
  const session = await requireSupabaseSession(request);
  if (session.error || !session.auth) {
    return session.error ?? apiErrorResponse(401, 'Unauthorized.', { route });
  }
  const auth = session.auth;
  const limited = await applyRateLimit(request, RATE_LIMITS.publishingAccounts, auth.userId);
  if (limited) return limited;
  // Service-role bypasses RLS: every query below is re-scoped by user_id,
  // and the persona row itself is the ownership proof. OAuth callers have
  // no cookie session, so they get the service client like API keys.
  const supabase =
    auth.isApiKey === true || auth.isOAuth === true
      ? createSupabaseServiceClient()
      : await createSupabaseServerClient();

  const personaId = new URL(request.url).searchParams.get('personaId');
  if (!personaId) {
    return apiErrorResponse(400, 'personaId is required.', {
      route,
      code: ERROR_CODES.VALIDATION_FAILED,
      field: 'personaId',
    });
  }
  if (!isPersonaAllowed(auth.personaIds, personaId)) {
    return apiErrorResponse(403, 'This API key cannot access this persona.', {
      route,
      code: ERROR_CODES.PERSONA_SCOPE_DENIED,
      field: 'personaId',
    });
  }
  return { auth, supabase, personaId };
}

async function getHandler(request: Request): Promise<NextResponse> {
  const ctx = await resolveContext(request, ROUTE);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const defaults = await getPersonaDefaultAccounts(ctx.supabase, ctx.personaId);
    return NextResponse.json({ success: true, defaults });
  } catch (error) {
    return libErrorToResponse(ROUTE, error);
  }
}

async function putHandler(request: Request): Promise<NextResponse> {
  const ctx = await resolveContext(request, PUT_ROUTE);
  if (ctx instanceof NextResponse) return ctx;

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return apiErrorResponse(400, 'Request body must be valid JSON.', {
      route: PUT_ROUTE,
      code: ERROR_CODES.VALIDATION_FAILED,
      field: 'accounts',
    });
  }
  const accounts = (body as { accounts?: unknown } | null)?.accounts;
  if (typeof accounts !== 'object' || accounts === null || Array.isArray(accounts)) {
    return apiErrorResponse(400, 'accounts must be an object mapping providers to account id arrays.', {
      route: PUT_ROUTE,
      code: ERROR_CODES.VALIDATION_FAILED,
      field: 'accounts',
    });
  }

  try {
    const defaults = await setPersonaDefaultAccounts({
      supabase: ctx.supabase,
      userId: ctx.auth.userId,
      personaId: ctx.personaId,
      accounts: accounts as Record<string, string[]>,
    });
    return NextResponse.json({ success: true, defaults });
  } catch (error) {
    return libErrorToResponse(PUT_ROUTE, error);
  }
}

export const GET = withApiErrorReporting(ROUTE, getHandler, { getUserId: resolveReportingUserId });
export const PUT = withApiErrorReporting(PUT_ROUTE, putHandler, { getUserId: resolveReportingUserId });
