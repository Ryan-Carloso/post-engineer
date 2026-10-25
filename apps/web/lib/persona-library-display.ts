//---------------
// Display-only library face for GET /api/persona/list.
// Picks one persona_images row to sign: newest primary (created_at desc,
// then id desc), else the newest non-primary. Never mixes personas.
//---------------

export interface LibraryDisplayImage {
  id: string;
  persona_id: string;
  image_path: string;
  is_primary: boolean;
  created_at: string;
}

export function pickLibraryDisplayImage(
  images: readonly LibraryDisplayImage[],
  personaId: string,
): LibraryDisplayImage | undefined {
  const mine = images.filter((image) => image.persona_id === personaId);
  if (mine.length === 0) return undefined;
  const primaries = mine.filter((image) => image.is_primary);
  const pool = primaries.length > 0 ? primaries : mine;
  return [...pool].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  })[0];
}
