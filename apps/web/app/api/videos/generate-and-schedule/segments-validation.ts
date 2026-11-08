// Segments request validation for POST /api/videos/generate-and-schedule.
// Runs before auth and before any token is charged. Segments are required:
// one call is one video with a complete script, so a request without
// segments fails here instead of dispatching an empty job. The shared
// validator reports the first content rule that fails in the script. The
// material matters: "images" needs media on every segment (the photos are
// the whole picture), checked here before any token is charged.
import { joinSegments, validateSegments } from '@/lib/generation/script-segments';
import { invalid, type Checked } from './validation-issues';

export function validateSegmentsRequest(rawSegments: unknown, material?: string): Checked<string> {
  if (rawSegments === undefined) {
    return {
      ok: false,
      issues: [
        invalid(
          'options.segments is required: send the full script as segments (first hook, then body, last CTA).',
          'options.segments',
        ),
      ],
    };
  }
  const result = validateSegments(rawSegments, material);
  if (!result.ok) {
    return {
      ok: false,
      issues: [invalid(`${result.error.rule} Fix: ${result.error.fix}`, `options.${result.error.field}`)],
    };
  }
  return { ok: true, value: joinSegments(rawSegments, material) };
}
