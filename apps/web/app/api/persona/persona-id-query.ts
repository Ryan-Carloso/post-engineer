import type { NextResponse } from 'next/server';
import { isPersonaAllowed } from '@/lib/api-keys';
import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES } from '@/lib/error-codes';
import { parsePersonaIdQuery } from '@/lib/contracts/personas';

export function scopedPersonaIdQuery(
  request: Request,
  personaScope: readonly string[] | null | undefined,
  route: string,
): { personaId: string } | { error: NextResponse } {
  const parsed = parsePersonaIdQuery(request.url);
  if (!parsed.ok) {
    return {
      error: apiErrorResponse(400, parsed.error, { route, code: ERROR_CODES.VALIDATION_FAILED, field: 'personaId' }),
    };
  }
  const personaId = parsed.query.personaId;
  if (!isPersonaAllowed(personaScope, personaId)) {
    return {
      error: apiErrorResponse(403, 'This API key cannot access this persona.', {
        route,
        code: ERROR_CODES.PERSONA_SCOPE_DENIED,
        field: 'personaId',
      }),
    };
  }
  return { personaId };
}
