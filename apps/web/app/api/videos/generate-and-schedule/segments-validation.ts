// Segments request validation for POST /api/videos/generate-and-schedule.
// Runs before auth and before any token is charged. Segments are required:
// one call is one video with a complete script, so a request without
// segments fails here instead of dispatching an empty job. The shared
// validator reports the first content rule that fails in the script. The
// video mode matters: images mode needs media on every segment (the photos
// are the whole picture), checked here before any token is charged, while
// full lip sync leaves media optional.
import { isVideoType, type VideoType } from '@/lib/tokens';
import { joinSegments, validateSegments } from '@/lib/generation/script-segments';
import { invalid, type Checked } from './validation-issues';

export function validateSegmentsRequest(rawSegments: unknown, videoType: string | undefined): Checked<string> {
  if (rawSegments === undefined) {
    return {
      ok: false,
      issues: [
        invalid(
          'options.segments is required: send the full script as segments (first hook, then content takes).',
          'options.segments',
        ),
      ],
    };
  }
  // An invalid/missing mode is rejected by validateOptions in the same
  // 400, so this read only picks the segment strictness for an already
  // rejected request: hook mode is the strictest (media on every segment).
  const mode: VideoType = isVideoType(videoType) ? videoType : 'hook_lipsync';
  const result = validateSegments(rawSegments, mode);
  if (!result.ok) {
    return {
      ok: false,
      issues: [invalid(`${result.error.rule} Fix: ${result.error.fix}`, `options.${result.error.field}`)],
    };
  }
  return { ok: true, value: joinSegments(rawSegments, mode) };
}
