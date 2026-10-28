// Mechanical validation for the segments script contract (MCP first, Phase 1).
// Mirrors apps/engine/app/services/script_segments.py: same limits,
// same accepted inputs, same field/rule/fix shape, with one documented
// exception in normalize() below (Python casefold vs JS toLowerCase).
// No LLM, no network, no TTS: the hook word guard runs here; measured TTS
// duration is checked by the engine when a hook-only TTS endpoint exists
// (Phase 1 gap, see validate_script).

export const MAX_SEGMENTS = 12;
export const MAX_MEDIAS = 6;
export const MIN_TOTAL_WORDS = 60;
export const MAX_TOTAL_WORDS = 200;
export const MIN_BODY_WORDS = 30;
export const MIN_CTA_WORDS = 5;
export const MAX_CTA_WORDS = 20;
export const MIN_HOOK_WORDS = 15;
export const MAX_HOOK_WORDS = 40;
export const MAX_TERMS_PER_SEGMENT = 10;
// Hook window from the engine persona_hook constants (8-12 seconds).
export const HOOK_MIN_SECONDS = 8;
export const HOOK_MAX_SECONDS = 12;

export type SegmentKind = 'hook' | 'body' | 'cta';

export type SegmentMedia = {
  mediaId?: string;
  url?: string;
};

export type ScriptSegment = {
  kind: SegmentKind;
  text: string;
  media?: SegmentMedia;
  terms?: string[];
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

export function validateSegments(input: unknown): SegmentsResult {
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
    // The engine rejects unknown segment keys and checks terms for every
    // segment: these checks must not hide behind the media loop below,
    // or a media-less segment with 11 terms (or an unknown key) passes
    // here while the engine rejects it.
    const unknown = Object.keys(segment)
      .filter((key) => key !== 'kind' && key !== 'text' && key !== 'media' && key !== 'terms')
      .sort();
    if (unknown.length > 0) {
      return fail(
        `segments.${i}`,
        `segment has unknown field ${unknown[0]}`,
        'Remove unknown fields from the segment.',
      );
    }
    const terms = segment.terms;
    if (terms !== undefined) {
      if (
        !Array.isArray(terms) ||
        terms.some((term) => typeof term !== 'string' || term.trim().length === 0) ||
        terms.length > MAX_TERMS_PER_SEGMENT
      ) {
        return fail(
          `segments.${i}.terms`,
          `terms must be non-empty strings, at most ${MAX_TERMS_PER_SEGMENT} per segment`,
          'Fix the terms list for this segment.',
        );
      }
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
  let mediaCount = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const media = segments[i].media;
    // Mirror the engine's _check_media: null media is skipped, not
    // rejected, and presence is key-present and non-null — a blank
    // string counts as present, so it fails the blank check instead
    // of passing as absent.
    if (media === undefined || media === null) continue;
    if (typeof media !== 'object') {
      return fail(`segments.${i}.media`, 'Media must be an object.', 'Send media as { mediaId } or { url }.');
    }
    // Unknown media keys are rejected, not stripped: the generation
    // route's strict media shape rejects them, so this validator must
    // too, or validate-script accepts what generation rejects.
    const unknownMedia = Object.keys(media)
      .filter((key) => key !== 'mediaId' && key !== 'url')
      .sort();
    if (unknownMedia.length > 0) {
      return fail(
        `segments.${i}.media`,
        `media has unknown field ${unknownMedia[0]}`,
        'Remove unknown fields from the media.',
      );
    }
    const mediaIdPresent = media.mediaId !== undefined && media.mediaId !== null;
    const urlPresent = media.url !== undefined && media.url !== null;
    if (mediaIdPresent && urlPresent) {
      return fail(
        `segments.${i}.media`,
        'Media has both mediaId and url.',
        'Send only one of mediaId or url for a segment.',
      );
    }
    if (!mediaIdPresent && !urlPresent) {
      return fail(
        `segments.${i}.media`,
        'Media has neither mediaId nor url.',
        'Send mediaId for an uploaded file or url for a direct image URL.',
      );
    }
    if (mediaIdPresent && (typeof media.mediaId !== 'string' || media.mediaId.trim().length === 0)) {
      return fail(`segments.${i}.media`, 'mediaId must be a non-empty string.', 'Send a non-empty mediaId.');
    }
    if (urlPresent && (typeof media.url !== 'string' || media.url.trim().length === 0)) {
      return fail(`segments.${i}.media`, 'url must be a non-empty string.', 'Send a non-empty image URL.');
    }
    mediaCount += 1;
  }
  if (mediaCount > MAX_MEDIAS) {
    return fail(
      'segments',
      `at most ${MAX_MEDIAS} medias are allowed per video`,
      'Remove medias until at most six remain.',
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

export function joinSegments(input: unknown): string {
  const result = validateSegments(input);
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
