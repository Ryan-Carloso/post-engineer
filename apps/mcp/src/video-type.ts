// The one video mode (issue #542 follow-up): the mode decides the render
// path and the price. Mirrors apps/engine/app/models/schema.py
// (VIDEO_TYPE_ERROR_SUFFIX + unknown_video_type_message) and
// apps/web/lib/tokens.ts — the same short message everywhere, pinned by
// the video-type sync test. Short on purpose: the MCP relays upstream
// errors through errors.ts, which truncates error detail at 200 chars
// (MAX_ERROR_BODY_CHARS), so the message must survive that cut whole.

export const VIDEO_TYPES = ['full_lipsync', 'hook_lipsync', 'faceless'] as const;

export type VideoType = (typeof VIDEO_TYPES)[number];

/** Narrow an untrusted value to a video mode. */
export function isVideoType(value: unknown): value is VideoType {
  return typeof value === 'string' && (VIDEO_TYPES as readonly string[]).includes(value);
}

/**
 * The invalid-video_type message suffix: every valid type WITH its token
 * cost, so the agent can choose knowing the price. Must stay identical to
 * the engine's VIDEO_TYPE_ERROR_SUFFIX (apps/engine/app/models/schema.py)
 * and the web's (apps/web/lib/tokens.ts) — the video-type sync test pins
 * the three together, and the numbers must match the web price tables.
 */
export const VIDEO_TYPE_ERROR_SUFFIX = 'use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)';

/** Missing-video_type error: same suffix, so the agent sees values + costs. */
export const VIDEO_TYPE_REQUIRED_MESSAGE = `videoType is required; ${VIDEO_TYPE_ERROR_SUFFIX}`;

/** Short invalid-video_type error, costs included, under 200 chars. */
export function unknownVideoTypeMessage(value: unknown): string {
  const shown = value === null || value === undefined ? '' : String(value).slice(0, 32);
  return `unknown video_type '${shown}'; ${VIDEO_TYPE_ERROR_SUFFIX}`;
}
