// Shared segments validation: single source of truth for the web app and
// the MCP server, for the segments script contract (MCP first, Phase 1).
// DO NOT EDIT this copy directly in apps/web or apps/mcp: the files at
// apps/web/lib/generation/script-segments.ts and
// apps/mcp/src/script-segments.ts are generated copies of this file.
// Edit here, then run `node scripts/sync-script-segments.mjs` from the
// repo root (both apps also run it from their prebuild/pretest scripts).
// Mirrors apps/engine/app/services/script_segments.py: same limits,
// same accepted inputs, same field/rule/fix shape, with one documented
// exception in normalize() below (Python casefold vs JS toLowerCase).
// No LLM, no network, no TTS: the hook word guard runs here; measured TTS
// duration is checked by the engine when a hook-only TTS endpoint exists
// (Phase 1 gap, see validate_script).

export const MAX_SEGMENTS = 12;
// Full lip sync renders the persona's face over the whole video, so media
// is optional there: at most 6 photos for the whole video. The images
// mode is the only other mode left: the agent's photos are the whole
// picture. One photo per ~3s of speech (8 words), each photo on screen at
// least ~1s (3 words), at most 30 photos per video. Same numbers as
// image_density.py.
export const MAX_MEDIAS = 6;
export const WORDS_PER_IMAGE = 8;
export const MIN_WORDS_PER_IMAGE = 3;
export const MAX_IMAGES_MODE_MEDIAS = 30;
export const MIN_TOTAL_WORDS = 60;
export const MAX_TOTAL_WORDS = 200;
export const MIN_BODY_WORDS = 30;
export const MIN_CTA_WORDS = 5;
export const MAX_CTA_WORDS = 20;
export const MIN_HOOK_WORDS = 15;
export const MAX_HOOK_WORDS = 40;
// The info card painted inside a segment photo's panel (engine media_overlay). Same
// numbers as MAX_OVERLAY_*_CHARS in apps/engine/app/services/script_segments.py;
// a sync test in the engine pins them.
export const MAX_OVERLAY_TITLE_CHARS = 60;
export const MAX_OVERLAY_SUBTITLE_CHARS = 80;
export const MAX_OVERLAY_BADGE_CHARS = 30;
const OVERLAY_LIMITS: Record<string, number> = {
  title: MAX_OVERLAY_TITLE_CHARS,
  subtitle: MAX_OVERLAY_SUBTITLE_CHARS,
  badge: MAX_OVERLAY_BADGE_CHARS,
};
// Hook window from the engine persona_hook constants (8-12 seconds).
export const HOOK_MIN_SECONDS = 8;
export const HOOK_MAX_SECONDS = 12;

export type SegmentKind = 'hook' | 'body' | 'cta';

export type SegmentOverlay = {
  title: string;
  subtitle?: string;
  badge?: string;
};

export type SegmentMedia = {
  mediaId?: string;
  url?: string;
  overlay?: SegmentOverlay;
};

export type ScriptSegment = {
  kind: SegmentKind;
  text: string;
  media?: SegmentMedia[];
};

export type SegmentsError = {
  field: string;
  rule: string;
  fix: string;
};

export type ValidatedSegments = {
  hookText: string;
  bodyTexts: string[];
  ctaText: string;
  totalWords: number;
  bodyWords: number;
  hookWords: number;
  ctaWords: number;
  segmentCount: number;
  mediaCount: number;
};

export type SegmentsResult =
  | { ok: true; value: ValidatedSegments }
  | { ok: false; error: SegmentsError };

function fail(field: string, rule: string, fix: string): SegmentsResult {
  return { ok: false, error: { field, rule, fix } };
}

// Half-up seconds, matching image_density.spoken_seconds.
function spokenSeconds(words: number): number {
  return Math.floor((words * 3 + Math.floor(WORDS_PER_IMAGE / 2)) / WORDS_PER_IMAGE);
}

function imageDensityError(words: number, count: number): { rule: string; fix: string } | null {
  const low = Math.ceil(words / WORDS_PER_IMAGE);
  const high = Math.max(1, Math.floor(words / MIN_WORDS_PER_IMAGE));
  const seconds = spokenSeconds(words);
  if (count < low) {
    const missing = low - count;
    const images = low === 1 ? 'image' : 'images';
    const more = missing === 1 ? 'image' : 'images';
    return {
      rule: `segment has ${words} words (~${seconds}s) and needs at least ${low} ${images} (one per ~3s); it has ${count}.`,
      fix: `Add ${missing} more ${more} to this segment's media array.`,
    };
  }
  if (count > high) {
    const images = high === 1 ? 'image' : 'images';
    return {
      rule: `segment has ${words} words (~${seconds}s) and allows at most ${high} ${images} (each image needs ~1s); it has ${count}.`,
      fix: `Remove images until this segment has at most ${high}.`,
    };
  }
  return null;
}

// Mirrors _check_overlay in the engine: an object with a non-empty title and
// optional non-empty subtitle/badge, nothing else, each within its limit.
function checkOverlay(overlay: unknown, field: string): SegmentsResult | null {
  if (typeof overlay !== 'object' || Array.isArray(overlay)) {
    return fail(field, 'Overlay must be an object.', 'Send overlay as { title, subtitle?, badge? }.');
  }
  const record = overlay as Record<string, unknown>;
  const unknown = Object.keys(record)
    .filter((key) => !(key in OVERLAY_LIMITS))
    .sort();
  if (unknown.length > 0) {
    return fail(field, `Overlay has unknown field ${unknown[0]}.`, 'Use only title, subtitle and badge in the overlay.');
  }
  const title = record.title;
  if (typeof title !== 'string' || title.trim().length === 0) {
    return fail(field, 'Overlay title must be a non-empty string.', 'Send the place name as the overlay title.');
  }
  for (const [key, limit] of Object.entries(OVERLAY_LIMITS)) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' || (key !== 'title' && value.trim().length === 0)) {
      return fail(field, `Overlay ${key} must be a non-empty string.`, `Send a non-empty overlay ${key} or omit it.`);
    }
    if (value.trim().length > limit) {
      return fail(
        field,
        `Overlay ${key} is longer than ${limit} characters.`,
        `Shorten the overlay ${key} to at most ${limit} characters.`,
      );
    }
  }
  return null;
}

function checkMediaItem(media: unknown, field: string): SegmentsResult | null {
  if (typeof media !== 'object' || media === null || Array.isArray(media)) {
    return fail(field, 'Media must be an object.', 'Send each image as { mediaId } or { url }.');
  }
  const record = media as Record<string, unknown>;
  const unknownMedia = Object.keys(record)
    .filter((key) => key !== 'mediaId' && key !== 'url' && key !== 'overlay')
    .sort();
  if (unknownMedia.length > 0) {
    return fail(field, `media has unknown field ${unknownMedia[0]}`, 'Remove unknown fields from the media.');
  }
  const mediaIdPresent = record.mediaId !== undefined && record.mediaId !== null;
  const urlPresent = record.url !== undefined && record.url !== null;
  if (mediaIdPresent && urlPresent) {
    return fail(field, 'Media has both mediaId and url.', 'Send only one of mediaId or url for a segment.');
  }
  if (!mediaIdPresent && !urlPresent) {
    return fail(field, 'Media has neither mediaId nor url.', 'Send mediaId for an uploaded file or url for a direct image URL.');
  }
  if (mediaIdPresent && (typeof record.mediaId !== 'string' || record.mediaId.trim().length === 0)) {
    return fail(field, 'mediaId must be a non-empty string.', 'Send a non-empty mediaId.');
  }
  if (urlPresent && (typeof record.url !== 'string' || record.url.trim().length === 0)) {
    return fail(field, 'url must be a non-empty string.', 'Send a non-empty image URL.');
  }
  if (record.overlay !== undefined && record.overlay !== null) {
    return checkOverlay(record.overlay, `${field}.overlay`);
  }
  return null;
}

// The same photo twice in one video is rejected on the second item.
// mediaId and url are different identities: the same characters in both
// fields are not the same photo. Comparison uses the trimmed value.
function repeatedPhoto(media: unknown, field: string, seen: Set<string>): SegmentsResult | null {
  if (typeof media !== 'object' || media === null || Array.isArray(media)) return null;
  const record = media as Record<string, unknown>;
  for (const key of ['mediaId', 'url']) {
    const value = record[key];
    if (typeof value !== 'string' || value.trim().length === 0) continue;
    const token = `${key}\u0000${value.trim()}`;
    if (seen.has(token)) {
      return fail(field, 'the same photo must not repeat', 'Use a different photo for each media item.');
    }
    seen.add(token);
    return null;
  }
  return null;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((word) => word.length > 0).length;
}

function hasForbiddenContent(text: string): boolean {
  const lower = text.toLowerCase();
  if (
    lower.includes('[insira') ||
    lower.includes('[insert') ||
    lower.includes('todo') ||
    lower.includes('lorem')
  ) {
    return true;
  }
  if (lower.includes('http://') || lower.includes('https://') || lower.includes('www.')) {
    return true;
  }
  if (
    text.includes('**') ||
    text.includes('__') ||
    text.includes('`') ||
    text.split('\n').some((line) => line.trim().startsWith('#'))
  ) {
    return true;
  }
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{FE0F}]/u.test(text)) {
    return true;
  }
  // Any bracketed span is a placeholder or a stage direction.
  return text.includes('[') || text.includes(']');
}

function normalize(text: string): string {
  // Mirrors the engine _normalized: strip punctuation, keep letters,
  // numbers, underscores and whitespace runs exactly as written (no
  // collapsing), then trim. JS \w is ASCII-only, so the class spells out
  // Unicode letters/numbers plus '_' to match Python's Unicode \w.
  // One remaining difference: Python casefold vs JS toLowerCase differ
  // on a few characters (for example ß), so this is a near mirror, not
  // byte-identical, for those edge cases.
  return text.toLowerCase().replace(/[^\p{L}\p{N}_\s]/gu, '').trim();
}

/** The one video mode (issue #542 follow-up). Defined here so this shared
 *  file stays dependency-free: the web and MCP copies are byte-identical
 *  generated files and cannot import either app's VideoType. Structurally
 *  identical to the VideoType in web lib/tokens.ts and MCP video-type.ts;
 *  the literal values are pinned together by the video-type sync tests. */
export type VideoType = 'full_lipsync' | 'hook_lipsync' | 'faceless';

export function validateSegments(input: unknown, videoType: VideoType = 'hook_lipsync'): SegmentsResult {
  if (!Array.isArray(input) || input.length === 0) {
    return fail(
      'segments',
      'segments must be a non-empty array',
      'Send hook, body and CTA segments in one array.',
    );
  }
  const segments = input as ScriptSegment[];
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (typeof segment !== 'object' || segment === null) {
      return fail(`segments.${i}`, 'Segment must be an object.', 'Send each segment as { kind, text }.');
    }
    if (segment.kind !== 'hook' && segment.kind !== 'body' && segment.kind !== 'cta') {
      return fail(
        `segments.${i}.kind`,
        'Segment kind must be hook, body, or cta.',
        'Set kind to hook for the first segment, body for the middle, cta for the last.',
      );
    }
    if (typeof segment.text !== 'string' || segment.text.trim().length === 0) {
      return fail(
        `segments.${i}.text`,
        'Segment text must be a non-empty string.',
        'Write the spoken text for this segment.',
      );
    }
    // The engine rejects unknown segment keys: this check must not hide
    // behind the media loop below, or a media-less segment with an
    // unknown key passes here while the engine rejects it.
    const unknown = Object.keys(segment)
      .filter((key) => key !== 'kind' && key !== 'text' && key !== 'media')
      .sort();
    if (unknown.length > 0) {
      return fail(
        `segments.${i}`,
        `segment has unknown field ${unknown[0]}`,
        'Remove unknown fields from the segment.',
      );
    }
  }
  const hooks = segments.filter((segment) => segment.kind === 'hook');
  const ctas = segments.filter((segment) => segment.kind === 'cta');
  const bodies = segments.filter((segment) => segment.kind === 'body');
  if (segments[0].kind !== 'hook') {
    return fail('segments.0.kind', 'the first segment must be the hook', 'Move the hook segment first.');
  }
  if (segments[segments.length - 1].kind !== 'cta') {
    return fail(
      `segments.${segments.length - 1}.kind`,
      'the last segment must be the CTA',
      'Move the CTA segment last.',
    );
  }
  if (hooks.length !== 1 || ctas.length !== 1 || bodies.length < 1) {
    return fail(
      'segments',
      'segments need exactly one hook, at least one body segment and exactly one CTA',
      'Send exactly one hook, one or more body segments and exactly one CTA.',
    );
  }
  for (let i = 0; i < segments.length; i += 1) {
    if (hasForbiddenContent(segments[i].text)) {
      return fail(
        `segments.${i}.text`,
        'segment text must not contain placeholders, links, markdown, emoji or stage directions',
        'Remove the placeholder, link, markdown, emoji or bracketed direction and resend the spoken text only.',
      );
    }
  }
  const hookText = hooks[0].text;
  const hookIndex = segments.indexOf(hooks[0]);
  if (!/[.!?。！？]$/.test(hookText.trim())) {
    return fail(
      `segments.${hookIndex}.text`,
      'the hook must end with terminal punctuation',
      'End the hook with a period, exclamation mark or question mark.',
    );
  }
  const seen = new Set<string>();
  for (let i = 0; i < segments.length; i += 1) {
    const normalized = normalize(segments[i].text);
    if (seen.has(normalized)) {
      return fail(
        `segments.${i}.text`,
        'the same segment text must not repeat',
        'Rewrite the repeated segment with different words.',
      );
    }
    seen.add(normalized);
  }
  const bodyTexts = bodies.map((segment) => segment.text);
  const bodyWords = bodyTexts.reduce((sum, text) => sum + countWords(text), 0);
  if (bodyWords < MIN_BODY_WORDS) {
    return fail(
      `segments.${segments.indexOf(bodies[0])}.text`,
      `Body must have at least ${MIN_BODY_WORDS} words.`,
      `Add body words until the body reaches ${MIN_BODY_WORDS} words.`,
    );
  }
  const ctaText = ctas[0].text;
  const ctaWords = countWords(ctaText);
  if (ctaWords < MIN_CTA_WORDS || ctaWords > MAX_CTA_WORDS) {
    return fail(
      `segments.${segments.indexOf(ctas[0])}.text`,
      `the CTA must be ${MIN_CTA_WORDS}-${MAX_CTA_WORDS} words`,
      'Shorten or lengthen the CTA to fit the word range.',
    );
  }
  const hookWords = countWords(hookText);
  if (hookWords < MIN_HOOK_WORDS || hookWords > MAX_HOOK_WORDS) {
    return fail(
      `segments.${hookIndex}.text`,
      `the hook must be ${MIN_HOOK_WORDS}-${MAX_HOOK_WORDS} words before TTS is measured`,
      'Rewrite the hook to fit the word range, then measure its spoken duration.',
    );
  }
  const totalWords = hookWords + bodyWords + ctaWords;
  if (totalWords < MIN_TOTAL_WORDS || totalWords > MAX_TOTAL_WORDS) {
    return fail(
      'segments',
      `the script must be ${MIN_TOTAL_WORDS}-${MAX_TOTAL_WORDS} words in total`,
      'Add or remove body content to fit the total word range.',
    );
  }
  if (segments.length > MAX_SEGMENTS) {
    return fail(
      'segments',
      `at most ${MAX_SEGMENTS} segments are allowed`,
      'Merge body segments until the count fits.',
    );
  }
  const imagesMode = videoType !== 'full_lipsync';
  const mediaCap = imagesMode ? MAX_IMAGES_MODE_MEDIAS : MAX_MEDIAS;
  let mediaCount = 0;
  const seenPhotos = new Set<string>();
  for (let i = 0; i < segments.length; i += 1) {
    const media = segments[i].media;
    // Null, missing, and an empty array are absent. A blank string on an
    // item still counts as present and fails the blank check. Images mode
    // has nothing to top a segment up with, so absence is rejected.
    const absent = media === undefined || media === null || (Array.isArray(media) && media.length === 0);
    if (absent) {
      if (imagesMode) {
        return fail(
          `segments.${i}.media`,
          'the images material needs media on every segment',
          'Send images for this segment as a list of { mediaId } or { url }.',
        );
      }
      continue;
    }
    if (!Array.isArray(media)) {
      return fail(`segments.${i}.media`, 'Media must be an array.', 'Send media as a list of { mediaId } or { url }.');
    }
    for (let j = 0; j < media.length; j += 1) {
      const itemField = `segments.${i}.media.${j}`;
      const itemError = checkMediaItem(media[j], itemField);
      if (itemError !== null) return itemError;
      const repeat = repeatedPhoto(media[j], itemField, seenPhotos);
      if (repeat !== null) return repeat;
    }
    if (imagesMode) {
      const density = imageDensityError(countWords(segments[i].text), media.length);
      if (density !== null) return fail(`segments.${i}.media`, density.rule, density.fix);
    }
    mediaCount += media.length;
  }
  if (mediaCount > mediaCap) {
    return fail(
      'segments',
      `at most ${mediaCap} medias are allowed per video`,
      imagesMode
        ? `Remove medias until at most ${mediaCap} remain, or merge segments so the per-segment minimums fit under ${mediaCap}.`
        : `Remove medias until at most ${mediaCap} remain.`,
    );
  }
  return {
    ok: true,
    value: {
      hookText,
      bodyTexts,
      ctaText,
      totalWords,
      bodyWords,
      hookWords,
      ctaWords,
      segmentCount: segments.length,
      mediaCount,
    },
  };
}

export function joinSegments(input: unknown, videoType: VideoType = 'hook_lipsync'): string {
  const result = validateSegments(input, videoType);
  if (!result.ok) {
    throw new Error(`${result.error.field}: ${result.error.rule} Fix: ${result.error.fix}`);
  }
  // The engine's segments_to_script strips each text before joining, and
  // TaskVideoRequest rejects a supplied script that differs from that
  // join — so a padded segment must join stripped here, or the
  // generation fails validation on a script the caller never mistyped.
  return [
    result.value.hookText.trim(),
    ...result.value.bodyTexts.map((text) => text.trim()),
    result.value.ctaText.trim(),
  ].join('\n\n');
}
