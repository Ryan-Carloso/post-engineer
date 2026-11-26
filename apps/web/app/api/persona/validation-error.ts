import type { NextResponse } from 'next/server';
import { apiErrorResponse, type ApiErrorOptions } from '@/lib/api-error';
import { ERROR_CODES } from '@/lib/error-codes';

export function personaValidationError(
  error: string,
  route: string,
  options?: Omit<ApiErrorOptions, 'route'>,
): NextResponse {
  return apiErrorResponse(400, error, { route, code: ERROR_CODES.VALIDATION_FAILED, ...options });
}
