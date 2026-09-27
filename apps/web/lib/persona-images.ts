import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  MAX_PERSONA_IMAGES,
  pushRecentImageId,
  selectPersonaImage,
  type ImageSelectionInput,
  type PersonaLibraryImage,
} from './persona-image-select';

export { MAX_PERSONA_IMAGES };

//---------------
// Shared persona image-library helpers: validation, storage upload, and row
// insert with rollback. Used by POST /api/persona (images[] at creation) and
// POST /api/persona/images (later additions).
//---------------

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
export const MAX_TAG_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 500;
const IMAGE_BUCKET = 'personas';

export interface LibraryImageInput {
  file: File;
  tag?: string;
  description?: string;
}

export function validateImageFile(
  file: unknown,
): { file: File; extension: string } | { error: string } {
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'An image file is required.' };
  }
  if (!file.type.startsWith('image/')) {
    return { error: 'Only image files are accepted.' };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { error: 'Image must be 10MB or smaller.' };
  }
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
    return { error: 'Image must be JPG, PNG, or WebP.' };
  }
  return { file, extension };
}

export async function countLibraryImages(
  supabase: SupabaseClient,
  personaId: string,
): Promise<number | null> {
  const { count, error } = await supabase
    .from('persona_images')
    .select('id', { count: 'exact', head: true })
    .eq('persona_id', personaId);
  if (error) {
    console.error('[persona-images] count failed', { error });
    return null;
  }
  return count ?? 0;
}

export interface LibraryImagesError {
  error: string;
  /** 400 for bad input (invalid file, full library), 500 for storage/DB failures. */
  status: 400 | 500;
}

/**
 * Validates, uploads, and inserts library images. Rolls back already-stored
 * files/rows when a later image fails, so the library never ends up
 * half-written. Returns the inserted rows on success.
 */
export async function addLibraryImages(
  supabase: SupabaseClient,
  userId: string,
  personaId: string,
  inputs: LibraryImageInput[],
): Promise<{ images: PersonaLibraryImage[] } | LibraryImagesError> {
  const existing = await countLibraryImages(supabase, personaId);
  if (existing === null) return { error: 'Failed to add image.', status: 500 };
  if (existing + inputs.length > MAX_PERSONA_IMAGES) {
    return { error: `Image library is full (${MAX_PERSONA_IMAGES} images max).`, status: 400 };
  }

  const added: PersonaLibraryImage[] = [];
  const storedPaths: string[] = [];
  const fail = async (error: string, status: 400 | 500): Promise<LibraryImagesError> => {
    await rollbackLibraryImages(supabase, added, storedPaths);
    return { error, status };
  };
  for (const input of inputs) {
    const validated = validateImageFile(input.file);
    if ('error' in validated) return fail(validated.error, 400);
    const path = `${userId}/${randomUUID()}.${validated.extension}`;
    const bytes = new Uint8Array(await validated.file.arrayBuffer());
    const { error: uploadError } = await supabase.storage
      .from(IMAGE_BUCKET)
      .upload(path, bytes, { contentType: validated.file.type });
    if (uploadError) {
      console.error('[persona-images] storage upload failed', { path, error: uploadError });
      return fail('Failed to upload image.', 500);
    }
    storedPaths.push(path);
    const { data, error: insertError } = await supabase
      .from('persona_images')
      .insert({
        persona_id: personaId,
        user_id: userId,
        image_path: path,
        tag: (input.tag ?? '').trim().slice(0, MAX_TAG_LENGTH),
        description: (input.description ?? '').trim().slice(0, MAX_DESCRIPTION_LENGTH),
        is_primary: false,
      })
      .select('id, image_path, tag, description, is_primary, created_at')
      .single();
    if (insertError || !data) {
      console.error('[persona-images] insert failed', { error: insertError });
      return fail('Failed to add image.', 500);
    }
    added.push(data as PersonaLibraryImage);
  }
  return { images: added };
}

async function rollbackLibraryImages(
  supabase: SupabaseClient,
  added: PersonaLibraryImage[],
  storedPaths: string[],
): Promise<void> {
  if (added.length > 0) {
    await supabase.from('persona_images').delete().in('id', added.map((image) => image.id));
  }
  if (storedPaths.length > 0) {
    await supabase.storage.from(IMAGE_BUCKET).remove(storedPaths);
  }
}

/** Marks one library image as primary and unsets the flag on the others. */
export async function setPrimaryLibraryImage(
  supabase: SupabaseClient,
  personaId: string,
  imageId: string,
): Promise<{ error: string } | null> {
  const { error: unsetError } = await supabase
    .from('persona_images')
    .update({ is_primary: false })
    .eq('persona_id', personaId)
    .neq('id', imageId);
  if (unsetError) {
    console.error('[persona-images] unset primary failed', { error: unsetError });
    return { error: 'Failed to update image.' };
  }
  const { error: setError } = await supabase
    .from('persona_images')
    .update({ is_primary: true })
    .eq('id', imageId);
  if (setError) {
    console.error('[persona-images] set primary failed', { error: setError });
    return { error: 'Failed to update image.' };
  }
  return null;
}

//---------------
// resolveVideoImage — deterministic per-video library image resolution.
//
// Priority: explicit image_id override > tag/description keyword match
// (excluding recently used images) > primary/first image. Empty library
// resolves to null so the caller falls back to the legacy photo/avatar.
// An unknown image_id is a 404, not a silent fallback. The recent-use
// history update is best-effort: it never fails the generation.
//---------------
export async function resolveVideoImage(
  supabase: SupabaseClient,
  personaId: string,
  recentImageIds: string[],
  input: ImageSelectionInput,
): Promise<
  | { ok: true; image: PersonaLibraryImage | null }
  | { ok: false; error: string; status: number }
> {
  const { data, error } = await supabase
    .from('persona_images')
    .select('id, image_path, tag, description, is_primary')
    .eq('persona_id', personaId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[persona-images] library fetch failed', { error });
    return { ok: false, error: 'Failed to load persona image library.', status: 500 };
  }
  const library = (data ?? []) as PersonaLibraryImage[];
  if (library.length === 0) return { ok: true, image: null };

  if (input.imageId && !library.some((image) => image.id === input.imageId)) {
    return {
      ok: false,
      error: "image_id not found in this persona's image library.",
      status: 404,
    };
  }

  const selected = selectPersonaImage(library, input, recentImageIds);
  if (!selected) return { ok: true, image: null };

  const { error: historyError } = await supabase
    .from('personas')
    .update({ recent_image_ids: pushRecentImageId(recentImageIds, selected.id) })
    .eq('id', personaId);
  if (historyError) {
    console.error('[persona-images] recent-image history update failed', {
      error: historyError,
    });
  }
  return { ok: true, image: selected };
}
