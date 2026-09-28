// Deterministic persona image selection — no LLM in the path.
//
// A persona can carry a library of photos (same person, different outfits or
// places), each with a tag and a description. For every generated video the
// selector picks the photo that best fits that video:
//
//   1. Explicit `imageId` on the request wins (ownership is validated by the
//      caller, not here). An unknown id selects nothing (null) — silently
//      substituting another face would put a photo in the video the user
//      didn't pick.
//   2. Keyword overlap between the video context (topic/niche/script) and the
//      image tag + description, excluding recently used images.
//   3. Primary image (or first) when nothing matches.
//
// The recently-used exclusion mirrors the BGM history window so consecutive
// videos don't reuse the same photo. Selection never fails: when every image
// is recent, the exclusion is lifted and the best match wins anyway.

export const MAX_PERSONA_IMAGES = 10;
export const PERSONA_IMAGE_HISTORY_LIMIT = 3;

// Client-safe upload limits: the picker gates on these before any bytes
// transfer, and the server enforces the same values in validateImageFile.
// They live in this dependency-free leaf (not in persona-images.ts, whose
// node:crypto import must not ride into the browser bundle) so the two
// sides cannot drift.
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// Explicit MIME allowlist: startsWith('image/') would also accept image/gif
// or image/svg+xml payloads renamed to .png, and API-key callers bypass the
// client-side filter.
export const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Stable warning codes emitted by the image routes on partial success.
 * Shared between producers (API routes) and consumers (UI warning mapper)
 * so a typo or rename breaks the build instead of silently rendering raw
 * codes.
 * This module must stay dependency-free: the 'use client'
 * persona-image-library imports these codes, and any Node builtin import
 * here (e.g. crypto) would ride into the browser bundle.
 */
export const PERSONA_IMAGE_WARNING_CODES = {
  PRIMARY_SWAP_FAILED: 'primary_swap_failed',
  METADATA_SAVE_FAILED: 'metadata_save_failed',
  // The mutation committed but the follow-up row refetch failed: the true
  // row state is unconfirmed. Never report this state as a total failure —
  // the committed change is real.
  ROW_REFETCH_FAILED: 'row_refetch_failed',
} as const;

export type PersonaImageWarningCode =
  (typeof PERSONA_IMAGE_WARNING_CODES)[keyof typeof PERSONA_IMAGE_WARNING_CODES];

export interface PersonaLibraryImage {
  id: string;
  image_path: string;
  tag: string;
  description: string;
  is_primary: boolean;
}

export interface ImageSelectionInput {
  topic?: string | null;
  niche?: string | null;
  script?: string | null;
  imageId?: string | null;
}

function tokenize(text: string): Set<string> {
  // Unicode-aware: personas may be created in non-Latin scripts (Cyrillic,
  // Greek, CJK). A Latin-only class would silently degrade scoring to
  // primary/first for those personas.
  // Note: CJK text has no word separators, so an entire topic becomes one
  // token and rarely matches a tag/description token exactly — scoring
  // degrades to primary/first for those users.
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2);
  return new Set(words);
}

function scoreImage(image: PersonaLibraryImage, keywords: Set<string>): number {
  if (keywords.size === 0) return 0;
  const haystack = tokenize(`${image.tag} ${image.description}`);
  let score = 0;
  for (const keyword of keywords) {
    if (haystack.has(keyword)) score += 1;
  }
  return score;
}

export function selectPersonaImage(
  images: PersonaLibraryImage[],
  input: ImageSelectionInput,
  recentIds: string[],
): PersonaLibraryImage | null {
  if (images.length === 0) return null;

  if (input.imageId !== undefined && input.imageId !== null) {
    const explicit = images.find((image) => image.id === input.imageId);
    // An explicit id that matches nothing is a hard stop: silently
    // substituting another photo would put a face in the video the user
    // didn't pick. The check is spelled out (not truthiness) so an
    // empty-string id also lands here instead of falling through to
    // automatic selection. The sole caller (resolveVideoImage) already
    // returns 404 for unknown ids, so this guards future direct callers.
    return explicit ?? null;
  }

  const recent = new Set(recentIds);
  const keywords = tokenize(
    [input.topic, input.niche, input.script].filter(Boolean).join(' '),
  );

  const eligible = images.filter((image) => !recent.has(image.id));
  const pool = eligible.length > 0 ? eligible : images;

  let best: PersonaLibraryImage | null = null;
  let bestScore = -1;
  for (const image of pool) {
    const score = scoreImage(image, keywords);
    // Relevance always wins; the primary flag only breaks ties, and list
    // order breaks ties between non-primary images (stable).
    const isBetter =
      score > bestScore ||
      (score === bestScore && image.is_primary && !(best?.is_primary ?? false));
    if (isBetter) {
      best = image;
      bestScore = score;
    }
  }
  return best;
}
