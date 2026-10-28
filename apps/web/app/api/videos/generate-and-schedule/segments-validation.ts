// Segments request validation for POST /api/videos/generate-and-schedule,
// extracted from route.ts so the route stays under the file-size ratchet.
// Runs before auth and before any token is charged. Returns the joined
// script, undefined when the request carries no segments, or a 400 response.
import type { NextResponse } from 'next/server';
import { ERROR_CODES } from '@/lib/error-codes';
import { validationFailed } from './prepare-persona';
import { joinSegments, validateSegments } from '@/lib/generation/script-segments';

export function validateSegmentsRequest(
  rawSegments: unknown,
  topicCount: number,
): string | undefined | NextResponse {
  if (rawSegments === undefined) return undefined;
  // One segments call is one video, so it needs exactly one topic.
  if (topicCount !== 1) {
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      'A segments request creates exactly one video: send exactly one topic.',
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
