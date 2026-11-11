// Slot-detail payload narrowing.
//
// Extracted from lib/api.ts so the api module stays under the file-size
// ratchet. The narrow helpers validate the final shape of the slot-detail
// payload at the fetch boundary: a malformed or missing block narrows to a
// safe default instead of handing the UI an undefined it would have to
// feature-detect at every render.
import { isPublishProvider, type PublishLink } from '@/lib/publish-links';

//---------------
// ProgressHistoryEntry — one observed (progress, stage) transition of a
// scheduled post, oldest first. Recorded change-only by GET
// /api/schedule/status while the post was live, so regressions (e.g.
// 40% -> 0%) stay visible after the fact.
//---------------
export interface ProgressHistoryEntry {
  progress: number;
  stage: string | null;
  recordedAt: string;
}

// What the post was generated with: the post_* snapshot columns written
// at creation (migration 012) plus the slot's faceless flag. Required with
// nullable leaves — the route always sends every key, so the UI never has
// to feature-detect.
export interface GenerationFacts {
  faceless: boolean;
  language: string | null;
  voiceId: string | null;
  videoAspect: string | null;
  videoLayout: string | null;
  niche: string | null;
  paragraphNumber: number | null;
  faceQuality: string | null;
}

//---------------
// narrowPublishLinks — the route has already derived and validated each
// link, so this validates the FINAL shape ({ provider, url }) rather than
// re-deriving it: resolvePublishLinks consumes the engine's raw shape
// (videoUrl / permalink / postId) and would drop everything here.
//
// The payload still crosses a network boundary, so a slot row predating the
// field — or a malformed entry — must read as "no links" instead of handing
// the UI an undefined it would have to guard at every render.
//---------------
export function narrowPublishLinks(value: unknown): PublishLink[] {
  if (!Array.isArray(value)) return [];
  const links: PublishLink[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const provider = record.provider;
    const url = record.url;
    // Unknown providers are dropped, not cast: a provider the UI doesn't
    // know would render its label map as literal "undefined".
    if (!isPublishProvider(provider) || typeof url !== 'string') continue;
    // An href reaching the DOM must stay https — a "javascript:" value in
    // the payload is an injection surface, not a broken link.
    if (!url.startsWith('https://')) continue;
    links.push({ provider, url });
  }
  return links;
}

//---------------
// narrowProgressHistory — same defensive pattern as narrowPublishLinks:
// the payload crosses a network boundary, so a slot row predating the
// field — or a malformed entry — reads as "no history" instead of handing
// the UI an undefined it would have to guard at every render.
//---------------
export function narrowProgressHistory(value: unknown): ProgressHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: ProgressHistoryEntry[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.progress !== 'number' || !Number.isFinite(record.progress)) continue;
    if (typeof record.recordedAt !== 'string') continue;
    entries.push({
      progress: record.progress,
      stage: typeof record.stage === 'string' ? record.stage : null,
      recordedAt: record.recordedAt,
    });
  }
  return entries;
}

//---------------
// narrowGeneration — the route always sends every key of the generation
// object, but the payload still crosses a network boundary: a malformed or
// missing block narrows to the all-null shape (faceless false) instead of
// handing the UI an undefined it would have to feature-detect at every
// render.
//---------------
export function narrowGeneration(value: unknown): GenerationFacts {
  const fallback: GenerationFacts = {
    faceless: false,
    language: null,
    voiceId: null,
    videoAspect: null,
    videoLayout: null,
    niche: null,
    paragraphNumber: null,
    faceQuality: null,
  };
  if (typeof value !== 'object' || value === null) return fallback;
  const record = value as Record<string, unknown>;
  const text = (key: string): string | null =>
    typeof record[key] === 'string' ? (record[key] as string) : null;
  const paragraphNumber = record.paragraphNumber;
  return {
    // Only the literal true counts — mirrors the route and the engine's
    // slot_faceless rule.
    faceless: record.faceless === true,
    language: text('language'),
    voiceId: text('voiceId'),
    videoAspect: text('videoAspect'),
    videoLayout: text('videoLayout'),
    niche: text('niche'),
    paragraphNumber:
      typeof paragraphNumber === 'number' && Number.isFinite(paragraphNumber)
        ? paragraphNumber
        : null,
    faceQuality: text('faceQuality'),
  };
}
