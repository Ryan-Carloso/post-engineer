// Segments request validation for POST /api/videos/generate-and-schedule,
// extracted from route.ts so the route stays under the file-size ratchet.
// Runs before auth and before any token is charged. Returns the joined
// script, or a 400 response. Segments are required: one call is one video
// with a complete script — a request without segments has nothing to
// generate, so it fails here instead of dispatching an empty job.
import type { NextResponse } from 'next/server';
import { ERROR_CODES } from '@/lib/error-codes';
import { validationFailed } from './prepare-persona';
import { joinSegments, validateSegments } from '@/lib/generation/script-segments';

export function validateSegmentsRequest(rawSegments: unknown): string | NextResponse {
  if (rawSegments === undefined) {
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      'options.segments is required: send the full script as segments (first hook, then body, last CTA).',
      'options.segments',
    );
  }
  const result = validateSegments(rawSegments);
  if (!result.ok) {
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      `${result.error.rule} Fix: ${result.error.fix}`,
      `options.${result.error.field}`,
    );
  }
  return joinSegments(rawSegments);
}
