//---------------
// Display-only library face for GET /api/persona/list.
// Picks one persona_images row to sign: the primary, else the newest
// (created_at desc, id desc). Never mixes rows across personas.
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
  const primary = mine.find((image) => image.is_primary);
  if (primary !== undefined) return primary;
  return [...mine].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  })[0];
}
