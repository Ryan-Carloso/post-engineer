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
