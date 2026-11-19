export const VIDEO_TYPES = ['full_lipsync', 'hook_lipsync', 'faceless'] as const;

export type VideoType = (typeof VIDEO_TYPES)[number];

export function isVideoType(value: unknown): value is VideoType {
  return typeof value === 'string' && (VIDEO_TYPES as readonly string[]).includes(value);
}

export const VIDEO_TYPE_ERROR_SUFFIX = 'use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)';

export const VIDEO_TYPE_REQUIRED_MESSAGE = `videoType is required; ${VIDEO_TYPE_ERROR_SUFFIX}`;

export function unknownVideoTypeMessage(value: unknown): string {
  const shown = value === null || value === undefined ? '' : String(value).slice(0, 32);
  return `unknown video_type '${shown}'; ${VIDEO_TYPE_ERROR_SUFFIX}`;
}
