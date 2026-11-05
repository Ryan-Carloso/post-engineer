import type { NextResponse } from 'next/server';
import { apiErrorResponse, type ApiErrorOptions } from '@/lib/api-error';
import { ERROR_CODES } from '@/lib/error-codes';

//---------------
// personaValidationError — the 400 every persona route (/api/persona,
// /api/persona/images) returns on invalid input. It carries the stable
// VALIDATION_FAILED code (and the failing field when known) so API, MCP and
// UI clients can react without parsing English copy, and PostHog groups the
// warnings by code. A caller-supplied code (e.g. UNKNOWN_VOICE) wins. Pass a
// logMessage when the client-facing message embeds user input (file names),
// so PostHog groups by the template instead of one issue per input.
//---------------
export function personaValidationError(
  error: string,
  route: string,
  options?: Omit<ApiErrorOptions, 'route'>,
): NextResponse {
  return apiErrorResponse(400, error, { route, code: ERROR_CODES.VALIDATION_FAILED, ...options });
}
