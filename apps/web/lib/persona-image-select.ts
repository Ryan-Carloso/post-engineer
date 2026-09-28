// Deterministic persona image selection — no LLM in the path.
//
// A persona can carry a library of photos (same person, different outfits or
// places), each with a tag and a description. For every generated video the
// selector picks the photo that best fits that video:
//
//   1. Explicit `imageId` on the request wins (ownership is validated by the
//      caller, not here).
//   2. Keyword overlap between the video context (topic/niche/script) and the
//      image tag + description, excluding recently used images.
//   3. Primary image (or first) when nothing matches.
//
// The recently-used exclusion mirrors the BGM history window so consecutive
// videos don't reuse the same photo. Selection never fails: when every image
// is recent, the exclusion is lifted and the best match wins anyway.

export const MAX_PERSONA_IMAGES = 10;
export const PERSONA_IMAGE_HISTORY_LIMIT = 3;

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
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9\u00c0-\u00ff]+/i)
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

  if (input.imageId) {
    const explicit = images.find((image) => image.id === input.imageId);
    if (explicit) return explicit;
    // Unreachable under the documented contract: the sole caller
    // (resolveVideoImage) returns 404 for an unknown id before ever calling
    // selectPersonaImage. The fall-through stays as a defensive last resort
    // for any future caller that skips that check — automatic selection
    // rather than a broken video job.
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

/** Prepends the chosen id, dedupes, and caps the history window. */
export function pushRecentImageId(
  recentIds: string[],
  imageId: string,
  limit: number = PERSONA_IMAGE_HISTORY_LIMIT,
): string[] {
  return [imageId, ...recentIds.filter((id) => id !== imageId)].slice(0, limit);
}
