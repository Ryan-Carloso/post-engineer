export const MAX_PERSONA_IMAGES = 10;
export const PERSONA_IMAGE_HISTORY_LIMIT = 3;

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const PERSONA_IMAGE_WARNING_CODES = {
  PRIMARY_SWAP_FAILED: 'primary_swap_failed',
  METADATA_SAVE_FAILED: 'metadata_save_failed',
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
  title?: string | null;
  niche?: string | null;
  script?: string | null;
  imageId?: string | null;
}

function tokenize(text: string): Set<string> {
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
    return explicit ?? null;
  }

  const recent = new Set(recentIds);
  const keywords = tokenize(
    [input.title, input.niche, input.script].filter(Boolean).join(' '),
  );

  const eligible = images.filter((image) => !recent.has(image.id));
  const pool = eligible.length > 0 ? eligible : images;

  let best: PersonaLibraryImage | null = null;
  let bestScore = -1;
  for (const image of pool) {
    const score = scoreImage(image, keywords);
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
