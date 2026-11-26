import type { NextResponse } from 'next/server';

import { apiErrorResponse } from '@/lib/api-error';
import type { ErrorCode } from '@/lib/error-codes';

const ROUTE = 'POST /api/media/publish-existing';

export function coded(
  status: number,
  code: ErrorCode,
  message: string,
  field?: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return apiErrorResponse(status, message, { code, field, route: ROUTE, extra });
}

export function validationFailed(
  code: ErrorCode,
  message: string,
  field?: string,
  status = 400,
): NextResponse {
  return coded(status, code, message, field);
}
