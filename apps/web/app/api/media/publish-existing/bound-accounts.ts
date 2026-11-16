import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { logger } from '@/lib/logger';
import { getPersonaDefaultAccounts, type PersonaDefaultAccounts } from '@/lib/persona-publishing-accounts';

//---------------
// loadPublishBinding — the persona's bound publishing accounts for
// POST /api/media/publish-existing. A persona-less publish has none.
// The persona is checked first (id + owner); getPersonaDefaultAccounts
// re-proves ownership and throws, so a persona deleted between the two
// reads is the same 404 and any other failure is a logged 500 — never an
// error escaping the handler.
//---------------

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function personaNotFound(route: string): NextResponse {
  return apiErrorResponse(404, formatErrorMessage(ERROR_CODES.PERSONA_NOT_FOUND), {
    route,
    code: ERROR_CODES.PERSONA_NOT_FOUND,
    field: 'personaId',
  });
}

function lookupFailed(route: string, error: unknown, userId: string): NextResponse {
  logger.error('[publish-existing] persona lookup failed', error, { userId });
  return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
    route,
    code: ERROR_CODES.INTERNAL_ERROR,
  });
}

export async function loadPublishBinding(
  supabase: SupabaseClient,
  personaId: string | null,
  userId: string,
  route: string,
): Promise<PersonaDefaultAccounts | null | NextResponse> {
  if (personaId === null) return null;
  const { data: persona, error: personaError } = await supabase
    .from('personas')
    .select('id')
    .eq('id', personaId)
    .eq('user_id', userId)
    .maybeSingle();
  if (personaError) return lookupFailed(route, personaError, userId);
  if (!persona) return personaNotFound(route);
  try {
    return await getPersonaDefaultAccounts(supabase, personaId, userId);
  } catch (error) {
    if (hasCode(error, ERROR_CODES.PERSONA_NOT_FOUND)) return personaNotFound(route);
    return lookupFailed(route, error, userId);
  }
}
