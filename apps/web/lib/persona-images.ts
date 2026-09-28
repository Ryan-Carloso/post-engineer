import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { detectMagicMimeType } from './media/magic-bytes';
import {
  MAX_PERSONA_IMAGES,
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
// Explicit MIME allowlist: startsWith('image/') would also accept image/gif
// or image/svg+xml payloads renamed to .png, and API-key callers bypass the
// client-side ACCEPTED_IMAGE_TYPES filter.
export const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_TAG_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 500;
export const IMAGE_BUCKET = 'personas';
/**
 * Stable SQLSTATE raised by the enforce_persona_image_limit trigger
 * (supabase/persona-images.sql). The app maps this code — not the English
 * trigger message — to a 400 "library full". Keep in sync with the SQL.
 */
export const PERSONA_IMAGE_LIMIT_SQLSTATE = 'PEL01';

export interface LibraryImageInput {
  file: File;
  tag?: string;
  description?: string;
}

//---------------
// isFileLike — files come from the server runtime (undici), whose File is
// not the same constructor as the test environment's; structural check.
// Exported for route handlers that must not use `instanceof File`.
//---------------
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
  // Size first: an oversized file with a wrong/missing type should report
  // the actionable size error, not a confusing type error.
  if (file.size > MAX_IMAGE_BYTES) {
    return { error: 'Image must be 10MB or smaller.' };
  }
  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
    return { error: 'Only image files are accepted.' };
  }
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
    return { error: 'Image must be JPG/JPEG, PNG, or WebP.' };
  }
  return { file, extension };
}

/**
 * Verifies image bytes against the declared MIME type. The declared type and
 * extension are client-controlled and spoofable; the magic bytes are not.
 * Returns the detected MIME type on success, or an error message.
 */
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
  if (detected !== declaredType) {
    return { error: 'The image content does not match its declared file type.' };
  }
  return { mime: detected };
}

/**
 * Reads the file and verifies its actual bytes against its declared MIME
 * type. Call this at the server boundary (addLibraryImages does) — never
 * trust the MCP/API caller's declared type alone.
 */
export async function validateImageContent(file: File): Promise<string | null> {
  const result = await readValidatedImage(file);
  return 'error' in result ? result.error : null;
}

/**
 * Reads a file and validates its magic bytes against its declared MIME
 * type. Shared by validateImageContent and addLibraryImages so the two
 * validation paths cannot drift apart.
 */
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

// Extension implied by the detected content type. The storage path uses this
// instead of the client-supplied file-name extension, so the path always
// matches the real bytes (WebP bytes named "photo.png" land on .webp, not
// .png).
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
    console.error('[persona-images] count failed', { error });
    return null;
  }
  return count ?? 0;
}

export interface LibraryImagesError {
  error: string;
  /** 400 for bad input (invalid file, full library), 500 for storage/DB failures. */
  status: 400 | 500;
  /**
   * Storage paths the best-effort rollback could not remove. Callers that
   * are about to cascade-delete the persona_images rows (making the paths
   * unrecoverable) should retry removal before that delete.
   */
  leftoverPaths?: string[];
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
  // Reject over-length input instead of truncating: silent truncation loses
  // caller data with no signal, and PATCH already rejects with 400.
  for (const input of inputs) {
    const tag = (input.tag ?? '').trim();
    const description = (input.description ?? '').trim();
    if (tag.length > MAX_TAG_LENGTH) {
      return { error: `Tag must be ${MAX_TAG_LENGTH} characters or fewer.`, status: 400 };
    }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return { error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`, status: 400 };
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
  // Sequential by design: each iteration reads at most one image (<=10MB)
  // into memory, and a failure rolls back exactly the images added so far.
  // Parallel reads would buffer up to 10 images at once and make the
  // rollback order nondeterministic.
  for (const input of inputs) {
    const validated = validateImageFile(input.file);
    if ('error' in validated) return fail(validated.error, 400);
    // A truncated multipart body makes arrayBuffer() reject: surface it as
    // a 400 validation error, not an unstructured 500.
    // Magic-byte check on the real bytes (single read, reused for upload):
    // the declared MIME type and extension are client-controlled. The
    // storage extension and content type come from the detected content so
    // the stored object matches the real bytes even when the file name or
    // declared type lies.
    const content = await readValidatedImage(validated.file);
    if ('error' in content) return fail(content.error, 400);
    const { bytes, mime } = content;
    const extension = DETECTED_MIME_TO_EXTENSION[mime] ?? validated.extension;
    const path = `${userId}/${randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from(IMAGE_BUCKET)
      .upload(path, bytes, { contentType: mime });
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
        tag: (input.tag ?? '').trim(),
        description: (input.description ?? '').trim(),
        is_primary: false,
      })
      .select('id, image_path, tag, description, is_primary, created_at')
      .single();
    if (insertError || !data) {
      console.error('[persona-images] insert failed', { error: insertError });
      // Two concurrent requests can both pass the app-level count check;
      // the loser hits the enforce_persona_image_limit trigger. A full
      // library is a client-input problem (the app 400s it in the
      // non-racing case), so recognize the trigger violation instead of a
      // generic 500. Match the stable PEL01 SQLSTATE, not the English
      // message — the message is human copy and may be reworded.
      if ((insertError as { code?: string } | null)?.code === PERSONA_IMAGE_LIMIT_SQLSTATE) {
        return fail(`Image library is full (${MAX_PERSONA_IMAGES} images max).`, 400);
      }
      return fail('Failed to add image.', 500);
    }
    added.push(data as PersonaLibraryImage);
  }
  return { images: added };
}

/**
 * Best-effort rollback of already-stored rows and files. Returns the storage
 * paths that could NOT be removed so the caller can retry before any
 * cascade makes them unrecoverable.
 */
async function rollbackLibraryImages(
  supabase: SupabaseClient,
  added: PersonaLibraryImage[],
  storedPaths: string[],
): Promise<string[]> {
  if (added.length > 0) {
    const { error: deleteError } = await supabase
      .from('persona_images')
      .delete()
      .in('id', added.map((image) => image.id));
    if (deleteError) {
      console.error('[persona-images] rollback row delete failed', { error: deleteError });
      // The rows survive, so their storage files are not orphaned yet — but
      // the caller must retry the row cleanup (or a cascade delete) before
      // removing storage. Surface the paths instead of pretending the
      // rollback finished cleanly. Uploaded paths WITHOUT a row (their
      // insert failed) are true orphans — no row references them, so remove
      // them now instead of dropping them from the leftovers.
      const rowPaths = new Set(added.map((image) => image.image_path));
      const rowlessPaths = storedPaths.filter((path) => !rowPaths.has(path));
      if (rowlessPaths.length > 0) {
        const { error: rowlessError } = await supabase.storage
          .from(IMAGE_BUCKET)
          .remove(rowlessPaths);
        if (rowlessError) {
          console.error('[persona-images] rollback rowless storage remove failed', {
            error: rowlessError,
            rowlessPaths,
          });
          return [...added.map((image) => image.image_path), ...rowlessPaths];
        }
      }
      return added.map((image) => image.image_path);
    }
  }
  if (storedPaths.length > 0) {
    const { error: removeError } = await supabase.storage.from(IMAGE_BUCKET).remove(storedPaths);
    if (removeError) {
      console.error('[persona-images] rollback storage remove failed', {
        error: removeError,
        storedPaths,
      });
      return storedPaths;
    }
  }
  return [];
}

/** Marks one library image as primary and unsets the flag on the others. */
export async function setPrimaryLibraryImage(
  supabase: SupabaseClient,
  personaId: string,
  imageId: string,
): Promise<{ error: string; status: number } | null> {
  // The swap runs inside the set_primary_persona_image SQL function: it
  // locks the parent persona row and performs demote-then-promote
  // back-to-back, so concurrent swaps cannot interleave (two separate
  // UPDATEs from the app could transiently leave zero or two primaries).
  const { error } = await supabase.rpc('set_primary_persona_image', {
    p_persona_id: personaId,
    p_image_id: imageId,
  });
  if (error) {
    console.error('[persona-images] set primary failed', { error });
    // P0002 is raised by the function when the image row vanished between
    // the route's ownership pre-check and the swap (e.g. a concurrent
    // delete): that's a 404, not a 500.
    if ((error as { code?: string }).code === 'P0002') {
      return { error: "Image not found in this persona's image library.", status: 404 };
    }
    return { error: 'Failed to update image.', status: 500 };
  }
  return null;
}

//---------------
// recordRecentImageId — appends an image to the persona's rotation history.
// The write goes through the record_persona_image_use SQL function so it is
// atomic: app-side read-modify-write could lose concurrent updates.
// Best-effort: a failed write is logged and never fails the generation.
// Call AFTER the token gate: a request rejected before the gate must not
// mark an image as used.
//---------------
export async function recordRecentImageId(
  supabase: SupabaseClient,
  personaId: string,
  imageId: string,
): Promise<void> {
  const { error } = await supabase.rpc('record_persona_image_use', {
    p_persona_id: personaId,
    p_image_id: imageId,
  });
  if (error) {
    console.error('[persona-images] recent-image history update failed', { error });
  }
}

//---------------
// resolveVideoImage — deterministic per-video library image resolution.
//
// Priority: explicit image_id override > tag/description keyword match
// (excluding recently used images) > primary/first image. Empty library
// resolves to null so the caller falls back to the legacy photo/avatar.
// An unknown image_id is a 404, not a silent fallback — even for an empty
// library. Explicit image_id overrides skip the rotation history: a pinned
// choice is not a rotation pick. This function never touches
// recent_image_ids — the caller records the pick via recordRecentImageId
// after the token gate.
//---------------
export async function resolveVideoImage(
  supabase: SupabaseClient,
  personaId: string,
  userId: string,
  recentImageIds: string[],
  input: ImageSelectionInput,
): Promise<
  | { ok: true; image: PersonaLibraryImage | null }
  | { ok: false; error: string; status: number }
> {
  // The user_id predicate is defense in depth: the route already verified
  // ownership, but with the service-role client this query must not read
  // another user's rows if a future caller ever skips that check.
  const { data, error } = await supabase
    .from('persona_images')
    .select('id, image_path, tag, description, is_primary')
    .eq('persona_id', personaId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[persona-images] library fetch failed', { error });
    return { ok: false, error: 'Failed to load persona image library.', status: 500 };
  }
  const library = (data ?? []) as PersonaLibraryImage[];
  // An explicit image_id is a 404 even when the library is empty — never a
  // silent fallback to the legacy photo.
  if (input.imageId && !library.some((image) => image.id === input.imageId)) {
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
