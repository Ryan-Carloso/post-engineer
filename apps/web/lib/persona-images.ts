import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { detectMagicMimeType } from './media/magic-bytes';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  MAX_PERSONA_IMAGES,
  PERSONA_IMAGE_WARNING_CODES,
  selectPersonaImage,
  type ImageSelectionInput,
  type PersonaImageWarningCode,
  type PersonaLibraryImage,
} from './persona-image-select';
import { logger } from '@/lib/logger';
import { MAX_DESCRIPTION_LENGTH, MAX_TAG_LENGTH } from '@/lib/contracts/personas';

export {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  MAX_PERSONA_IMAGES,
  PERSONA_IMAGE_WARNING_CODES,
  type PersonaImageWarningCode,
};

export const ALLOWED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
export { MAX_DESCRIPTION_LENGTH, MAX_TAG_LENGTH };
export const IMAGE_BUCKET = 'personas';
export const IMAGE_URL_TTL_SECONDS = 3600;
export const PERSONA_IMAGE_LIMIT_SQLSTATE = 'PEL01';

export function personaAssetPath(userId: string, personaId: string, fileName: string): string {
  const segments = [userId, personaId];
  for (const segment of segments) {
    if (segment.length === 0 || segment.includes('/')) {
      throw new Error('personaAssetPath: userId and personaId must be non-empty path segments.');
    }
  }
  if (fileName.length === 0 || fileName.startsWith('/')) {
    throw new Error('personaAssetPath: fileName must be a non-empty relative path.');
  }
  return `${userId}/${personaId}/${fileName}`;
}

export interface LibraryImageInput {
  file: File;
  tag?: string;
  description?: string;
  validatedContent?: { bytes: Uint8Array; mime: string };
}

export function isFileLike(value: unknown): value is File {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.type === 'string' &&
    typeof candidate.size === 'number' &&
    candidate.arrayBuffer instanceof Function
  );
}

export function validateImageFile(
  file: unknown,
): { file: File; extension: string } | { error: string } {
  if (!isFileLike(file) || file.size === 0) {
    return { error: 'An image file is required.' };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { error: 'Image must be 10MB or smaller.' };
  }
  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
    return { error: 'Only image files are accepted.' };
  }
  const dotIndex = file.name.lastIndexOf('.');
  const extension = dotIndex > 0 ? file.name.slice(dotIndex + 1).toLowerCase() : '';
  if (!ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
    return { error: 'Image must be JPG/JPEG, PNG, or WebP.' };
  }
  return { file, extension };
}

export function validateImageBuffer(
  buffer: Buffer,
  declaredType: string,
): { mime: string } | { error: string } {
  const detected = detectMagicMimeType(buffer);
  if (!detected) {
    return { error: 'Could not verify the image content: the file is not a recognized image.' };
  }
  if (!ALLOWED_IMAGE_MIME_TYPES.has(detected)) {
    return { error: 'Only JPG/JPEG, PNG, or WebP images are accepted.' };
  }
  if (!declaredType) {
    return { error: 'No image content type was declared for this file.' };
  }
  const declared = declaredType === 'image/jpg' ? 'image/jpeg' : declaredType;
  if (detected !== declared) {
    return { error: 'The image content does not match its declared file type.' };
  }
  return { mime: detected };
}

export async function readValidatedImage(
  file: File,
): Promise<{ bytes: Uint8Array; mime: string } | { error: string }> {
  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch {
    return { error: 'Could not read the image file.' };
  }
  const result = validateImageBuffer(buffer, file.type);
  if ('error' in result) return result;
  return { bytes: new Uint8Array(buffer), mime: result.mime };
}

const DETECTED_MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function countLibraryImages(
  supabase: SupabaseClient,
  personaId: string,
): Promise<number | null> {
  const { count, error } = await supabase
    .from('persona_images')
    .select('id', { count: 'exact', head: true })
    .eq('persona_id', personaId);
  if (error) {
    logger.error('[persona-images] count failed', error);
    return null;
  }
  return count ?? 0;
}

export interface LibraryImagesError {
  error: string;
  status: 400 | 500;
  leftoverPaths?: { orphanPaths: string[]; rowBackedPaths: string[] };
}

export async function addLibraryImages(
  supabase: SupabaseClient,
  userId: string,
  personaId: string,
  inputs: LibraryImageInput[],
): Promise<{ images: PersonaLibraryImage[] } | LibraryImagesError> {
  if (inputs.length === 0) {
    return { error: 'At least one image file is required.', status: 400 };
  }
  const normalized = inputs.map((input) => ({
    ...input,
    tag: (input.tag ?? '').trim(),
    description: (input.description ?? '').trim(),
  }));
  for (const input of normalized) {
    if (input.tag.length > MAX_TAG_LENGTH) {
      return { error: `tag must be at most ${MAX_TAG_LENGTH} characters.`, status: 400 };
    }
    if (input.description.length > MAX_DESCRIPTION_LENGTH) {
      return { error: `description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`, status: 400 };
    }
  }
  const existing = await countLibraryImages(supabase, personaId);
  if (existing === null) return { error: 'Failed to add image.', status: 500 };
  if (existing + inputs.length > MAX_PERSONA_IMAGES) {
    return { error: `Image library is full (${MAX_PERSONA_IMAGES} images max).`, status: 400 };
  }

  const added: PersonaLibraryImage[] = [];
  const storedPaths: string[] = [];
  const fail = async (error: string, status: 400 | 500): Promise<LibraryImagesError> => {
    const leftoverPaths = await rollbackLibraryImages(supabase, added, storedPaths);
    return { error, status, leftoverPaths };
  };
  for (const input of normalized) {
    const validated = validateImageFile(input.file);
    if ('error' in validated) return fail(validated.error, 400);
    const content = input.validatedContent ?? (await readValidatedImage(validated.file));
    if ('error' in content) return fail(content.error, 400);
    const { bytes, mime } = content;
    const extension = DETECTED_MIME_TO_EXTENSION[mime] ?? validated.extension;
    const path = personaAssetPath(userId, personaId, `images/${randomUUID()}.${extension}`);
    const { error: uploadError } = await supabase.storage
      .from(IMAGE_BUCKET)
      .upload(path, bytes, { contentType: mime });
    if (uploadError) {
      logger.error('[persona-images] storage upload failed', uploadError, { path });
      return fail('Failed to upload image.', 500);
    }
    storedPaths.push(path);
    const { data, error: insertError } = await supabase
      .from('persona_images')
      .insert({
        persona_id: personaId,
        user_id: userId,
        image_path: path,
        tag: input.tag,
        description: input.description,
        is_primary: false,
      })
      .select('id, image_path, tag, description, is_primary, created_at')
      .single();
    if (insertError || !data) {
      logger.error('[persona-images] insert failed', insertError);
      if ((insertError as { code?: string } | null)?.code === PERSONA_IMAGE_LIMIT_SQLSTATE) {
        return fail(`Image library is full (${MAX_PERSONA_IMAGES} images max).`, 400);
      }
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
): Promise<{ orphanPaths: string[]; rowBackedPaths: string[] }> {
  const empty = { orphanPaths: [] as string[], rowBackedPaths: [] as string[] };
  if (added.length > 0) {
    const { error: deleteError } = await supabase
      .from('persona_images')
      .delete()
      .in('id', added.map((image) => image.id));
    if (deleteError) {
      logger.error('[persona-images] rollback row delete failed', deleteError);
      const { error: retryError } = await supabase
        .from('persona_images')
        .delete()
        .in('id', added.map((image) => image.id));
      const rowPaths = new Set(added.map((image) => image.image_path));
      const rowlessPaths = storedPaths.filter((path) => !rowPaths.has(path));
      let orphanPaths = rowlessPaths;
      if (rowlessPaths.length > 0) {
        const { error: rowlessError } = await supabase.storage
          .from(IMAGE_BUCKET)
          .remove(rowlessPaths);
        if (rowlessError) {
          logger.error('[persona-images] rollback rowless storage remove failed', rowlessError, { rowlessPaths });
        } else {
          orphanPaths = [];
        }
      }
      if (retryError) {
        logger.error('[persona-images] rollback row delete retry failed', retryError);
        return { orphanPaths, rowBackedPaths: [...rowPaths] };
      }
    }
  }
  if (storedPaths.length > 0) {
    const { error: removeError } = await supabase.storage.from(IMAGE_BUCKET).remove(storedPaths);
    if (removeError) {
      logger.error('[persona-images] rollback storage remove failed', removeError, { storedPaths });
      return { orphanPaths: storedPaths, rowBackedPaths: [] };
    }
  }
  return empty;
}

export async function removeOrphanedUploadPaths(
  supabase: SupabaseClient,
  orphanPaths: string[],
  logContext: Record<string, unknown>,
): Promise<void> {
  if (orphanPaths.length === 0) return;
  const { error } = await supabase.storage.from(IMAGE_BUCKET).remove(orphanPaths);
  if (error) {
    logger.error('[persona-images] orphaned upload storage paths could not be removed', undefined, {
      ...logContext,
      orphanPaths,
      removeError: error,
    });
  }
}

export async function setPrimaryLibraryImage(
  supabase: SupabaseClient,
  personaId: string,
  imageId: string,
  userId: string,
): Promise<{ error: string; status: 404 | 500 } | null> {
  const { error } = await supabase.rpc('set_primary_persona_image', {
    p_persona_id: personaId,
    p_image_id: imageId,
    p_user_id: userId,
  });
  if (error) {
    logger.error('[persona-images] set primary failed', error);
    if ((error as { code?: string }).code === 'P0002') {
      return { error: "Image not found in this persona's image library.", status: 404 };
    }
    return { error: 'Failed to update image.', status: 500 };
  }
  return null;
}

export async function recordRecentImageId(
  supabase: SupabaseClient,
  personaId: string,
  imageId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase.rpc('record_persona_image_use', {
    p_persona_id: personaId,
    p_image_id: imageId,
    p_user_id: userId,
  });
  if (error) {
    logger.error('[persona-images] recent-image history update failed', error);
  }
}

export async function resolveVideoImage(
  supabase: SupabaseClient,
  personaId: string,
  userId: string,
  recentImageIds: string[],
  input: ImageSelectionInput,
): Promise<
  | { ok: true; image: PersonaLibraryImage | null }
  | { ok: false; error: string; status: 404 | 500 }
> {
  const { data, error } = await supabase
    .from('persona_images')
    .select('id, image_path, tag, description, is_primary')
    .eq('persona_id', personaId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) {
    logger.error('[persona-images] library fetch failed', error);
    return { ok: false, error: 'Failed to load persona image library.', status: 500 };
  }
  const library = (data ?? []) as PersonaLibraryImage[];
  if (
    input.imageId !== undefined &&
    input.imageId !== null &&
    !library.some((image) => image.id === input.imageId)
  ) {
    return {
      ok: false,
      error: "image_id not found in this persona's image library.",
      status: 404,
    };
  }
  if (library.length === 0) return { ok: true, image: null };

  const selected = selectPersonaImage(library, input, recentImageIds);
  if (!selected) return { ok: true, image: null };
  return { ok: true, image: selected };
}
