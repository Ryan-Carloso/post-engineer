import { NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/api-error';

//---------------
// errorResponse — the route's error helper: a thin wrapper over
// apiErrorResponse with the route name attached.
//---------------
export function errorResponse(
  status: number,
  error: string,
  route: string,
  options?: { cause?: unknown; logMessage?: string; metadata?: Record<string, unknown>; code?: string; leaveReportingToWrapper?: boolean },
): NextResponse {
  return apiErrorResponse(status, error, { route, ...options });
}
