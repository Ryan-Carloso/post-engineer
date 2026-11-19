import { NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/api-error';

export function errorResponse(
  status: number,
  error: string,
  route: string,
  options?: { cause?: unknown; logMessage?: string; metadata?: Record<string, unknown>; code?: string; leaveReportingToWrapper?: boolean },
): NextResponse {
  return apiErrorResponse(status, error, { route, ...options });
}
