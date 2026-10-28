// Mechanical segments validation for the MCP server (Phase 1).
// This is an MCP-side copy of apps/web/lib/generation/script-segments.ts
// (which mirrors apps/engine/app/services/script_segments.py): the published
// MCP package cannot import from apps/web, so the rules live here too.
// Keep the limits, accepted inputs and field names in sync across all three;
// the tools-single-video tests pin the same fixtures as the web tests.
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
export type SegmentMedia = { mediaId?: string; url?: string };
export type ScriptSegment = {
  kind: SegmentKind;
  text: string;
  media?: SegmentMedia;
  terms?: string[];
};
export type SegmentsError = { field: string; rule: string; fix: string };
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
  return text.includes('[') || text.includes(']');
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateSegments(input: unknown): SegmentsResult {
  if (!Array.isArray(input) || input.length === 0) {
    return fail('segments', 'segments must be a non-empty array', 'Send hook, body and CTA segments in one array.');
  }
  const segments = input as ScriptSegment[];
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (
      typeof segment !== 'object' ||
      segment === null ||
      (segment.kind !== 'hook' && segment.kind !== 'body' && segment.kind !== 'cta') ||
      typeof segment.text !== 'string' ||
      segment.text.trim().length === 0
    ) {
      return fail(`segments.${i}.text`, 'each segment needs a kind (hook, body or cta) and non-empty text', 'Fill in the missing segment text.');
    }
    // The engine rejects unknown segment keys and checks terms for every
    // segment: these checks must not hide behind the media loop below,
    // or a media-less segment with 11 terms (or an unknown key) passes
    // here while the engine rejects it.
    const unknown = Object.keys(segment)
      .filter((key) => key !== 'kind' && key !== 'text' && key !== 'media' && key !== 'terms')
      .sort();
    if (unknown.length > 0) {
      return fail(`segments.${i}`, `segment has unknown field ${unknown[0]}`, 'Remove unknown fields from the segment.');
    }
    const terms = segment.terms;
    if (terms !== undefined) {
      if (
        !Array.isArray(terms) ||
        terms.some((term) => typeof term !== 'string' || term.trim().length === 0) ||
        terms.length > MAX_TERMS_PER_SEGMENT
      ) {
        return fail(`segments.${i}.terms`, `terms must be non-empty strings, at most ${MAX_TERMS_PER_SEGMENT} per segment`, 'Fix the terms list for this segment.');
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
    return fail(`segments.${segments.length - 1}.kind`, 'the last segment must be the CTA', 'Move the CTA segment last.');
  }
  if (hooks.length !== 1 || ctas.length !== 1 || bodies.length < 1) {
    return fail('segments', 'segments need exactly one hook, at least one body segment and exactly one CTA', 'Send exactly one hook, one or more body segments and exactly one CTA.');
  }
  for (let i = 0; i < segments.length; i += 1) {
    if (hasForbiddenContent(segments[i].text)) {
      return fail(`segments.${i}.text`, 'segment text must not contain placeholders, links, markdown, emoji or stage directions', 'Remove the placeholder, link, markdown, emoji or bracketed direction and resend the spoken text only.');
    }
  }
  const hookText = hooks[0].text;
  const hookIndex = segments.indexOf(hooks[0]);
  if (!/[.!?。！？]$/.test(hookText.trim())) {
    return fail(`segments.${hookIndex}.text`, 'the hook must end with terminal punctuation', 'End the hook with a period, exclamation mark or question mark.');
  }
  const seen = new Set<string>();
  for (let i = 0; i < segments.length; i += 1) {
    const normalized = normalize(segments[i].text);
    if (seen.has(normalized)) {
      return fail(`segments.${i}.text`, 'the same segment text must not repeat', 'Rewrite the repeated segment with different words.');
    }
    seen.add(normalized);
  }
  const bodyTexts = bodies.map((segment) => segment.text);
  const bodyWords = bodyTexts.reduce((sum, text) => sum + countWords(text), 0);
  if (bodyWords < MIN_BODY_WORDS) {
    return fail('segments', `body segments need at least ${MIN_BODY_WORDS} words in total`, 'Add more body content before the CTA.');
  }
  const ctaText = ctas[0].text;
  const ctaWords = countWords(ctaText);
  if (ctaWords < MIN_CTA_WORDS || ctaWords > MAX_CTA_WORDS) {
    return fail(`segments.${segments.indexOf(ctas[0])}.text`, `the CTA must be ${MIN_CTA_WORDS}-${MAX_CTA_WORDS} words`, 'Shorten or lengthen the CTA to fit the word range.');
  }
  const hookWords = countWords(hookText);
  if (hookWords < MIN_HOOK_WORDS || hookWords > MAX_HOOK_WORDS) {
    return fail(`segments.${hookIndex}.text`, `the hook must be ${MIN_HOOK_WORDS}-${MAX_HOOK_WORDS} words before TTS is measured`, 'Rewrite the hook to fit the word range, then measure its spoken duration.');
  }
  const totalWords = hookWords + bodyWords + ctaWords;
  if (totalWords < MIN_TOTAL_WORDS || totalWords > MAX_TOTAL_WORDS) {
    return fail('segments', `the script must be ${MIN_TOTAL_WORDS}-${MAX_TOTAL_WORDS} words in total`, 'Add or remove body content to fit the total word range.');
  }
  if (segments.length > MAX_SEGMENTS) {
    return fail('segments', `at most ${MAX_SEGMENTS} segments are allowed`, 'Merge body segments until the count fits.');
  }
  let mediaCount = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const media = segments[i].media;
    if (media === undefined) continue;
    if (
      typeof media !== 'object' ||
      media === null ||
      ((typeof media.mediaId === 'string' && media.mediaId.length > 0) ===
        (typeof media.url === 'string' && media.url.length > 0))
    ) {
      return fail(`segments.${i}.media`, 'media needs exactly one of mediaId or url', 'Send either a mediaId or a url for this segment, not both and not neither.');
    }
    mediaCount += 1;
  }
  if (mediaCount > MAX_MEDIAS) {
    return fail('segments', `at most ${MAX_MEDIAS} medias are allowed per video`, 'Remove medias until at most six remain.');
  }
  return {
    ok: true,
    value: { hookText, bodyTexts, ctaText, totalWords, bodyWords, hookWords, ctaWords, segmentCount: segments.length, mediaCount },
  };
}

export function joinSegments(input: unknown): string {
  const result = validateSegments(input);
  if (!result.ok) {
    throw new Error(`${result.error.field}: ${result.error.rule} Fix: ${result.error.fix}`);
  }
  return [result.value.hookText, ...result.value.bodyTexts, result.value.ctaText].join('\n\n');
}
