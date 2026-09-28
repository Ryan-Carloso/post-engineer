import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { detectMagicMimeType } from './media/magic-bytes';
// Client-safe shared constants (upload limits, warning codes, selection
// inputs) live in the dependency-free persona-image-select leaf: the
// 'use client' library component imports them from there, and this module's
// top-level node:crypto import must not ride into the browser bundle.
// Re-exported here so server consumers keep a single import site.
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

export {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  MAX_PERSONA_IMAGES,
  PERSONA_IMAGE_WARNING_CODES,
  type PersonaImageWarningCode,
};

//---------------
// Shared persona image-library helpers: validation, storage upload, and row
// insert with rollback. Used by POST /api/persona (images[] at creation) and
// POST /api/persona/images (later additions).
//---------------

export const ALLOWED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
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
  /**
   * Pre-validated content (bytes + detected MIME). When present,
   * addLibraryImages reuses it instead of re-reading the file — the
   * creation route validates upfront (fail-fast before any insert) and
   * passes the bytes through, avoiding a second full read.
   */
  validatedContent?: { bytes: Uint8Array; mime: string };
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
  // Normalize the common-but-nonstandard 'image/jpg' alias before comparing:
  // some cameras, older browsers, and HTTP clients declare JPEG bytes this
  // way, and rejecting them would be a misleading "mismatch" error.
  // An absent declared type (API-key callers can omit it) gets its own
  // message so the error stays actionable.
  if (!declaredType) {
    return { error: 'No image content type was declared for this file.' };
  }
  const declared = declaredType === 'image/jpg' ? 'image/jpeg' : declaredType;
  if (detected !== declared) {
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
   * Storage paths the best-effort rollback could not remove. Split so
   * callers never delete a file that a surviving row still references:
   * - orphanPaths: no row references these; safe to storage.remove(), and
   *   collect them before any cascade delete makes them unrecoverable.
   * - rowBackedPaths: rows still exist. Never storage.remove() these while
   *   the rows survive — only after the rows are gone (a row-delete retry
   *   or a successful cascade delete of the parent persona), or surviving
   *   rows dangle at deleted objects.
   */
  leftoverPaths?: { orphanPaths: string[]; rowBackedPaths: string[] };
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
  // The shared helper owns the contract: an empty batch is a caller bug,
  // not a 200 no-op.
  if (inputs.length === 0) {
    return { error: 'At least one image file is required.', status: 400 };
  }
  // Normalize once: trim tag/description up front so the length checks and
  // the insert below can't drift apart (two trim sites would).
  const normalized = inputs.map((input) => ({
    ...input,
    tag: (input.tag ?? '').trim(),
    description: (input.description ?? '').trim(),
  }));
  // Reject over-length input instead of truncating: silent truncation loses
  // caller data with no signal, and PATCH already rejects with 400. The
  // wording matches the PATCH route's shape so the UI's error-class
  // patterns classify both producers identically.
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
  // Sequential by design: each iteration reads at most one image (<=10MB)
  // into memory, and a failure rolls back exactly the images added so far.
  // Parallel reads would buffer up to 10 images at once and make the
  // rollback order nondeterministic.
  for (const input of normalized) {
    const validated = validateImageFile(input.file);
    if ('error' in validated) return fail(validated.error, 400);
    // A truncated multipart body makes arrayBuffer() reject: surface it as
    // a 400 validation error, not an unstructured 500.
    // Magic-byte check on the real bytes (single read, reused for upload):
    // the declared MIME type and extension are client-controlled. The
    // storage extension and content type come from the detected content so
    // the stored object matches the real bytes even when the file name or
    // declared type lies. When the caller pre-validated (creation route),
    // reuse those bytes instead of reading the file a second time.
    const content = input.validatedContent ?? (await readValidatedImage(validated.file));
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
        // Already trimmed in the normalization step above.
        tag: input.tag,
        description: input.description,
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
): Promise<{ orphanPaths: string[]; rowBackedPaths: string[] }> {
  const empty = { orphanPaths: [] as string[], rowBackedPaths: [] as string[] };
  if (added.length > 0) {
    const { error: deleteError } = await supabase
      .from('persona_images')
      .delete()
      .in('id', added.map((image) => image.id));
    if (deleteError) {
      console.error('[persona-images] rollback row delete failed', { error: deleteError });
      // The rows survive, so their storage files are not orphaned yet.
      // Retry the row delete once: if it succeeds the paths become true
      // orphans; if it still fails, split the return so callers never
      // storage.remove() a file a surviving row references.
      const { error: retryError } = await supabase
        .from('persona_images')
        .delete()
        .in('id', added.map((image) => image.id));
      const rowPaths = new Set(added.map((image) => image.image_path));
      const rowlessPaths = storedPaths.filter((path) => !rowPaths.has(path));
      // Uploaded paths WITHOUT a row (their insert failed) are true orphans
      // — no row references them, so remove them now instead of dropping
      // them from the leftovers.
      let orphanPaths = rowlessPaths;
      if (rowlessPaths.length > 0) {
        const { error: rowlessError } = await supabase.storage
          .from(IMAGE_BUCKET)
          .remove(rowlessPaths);
        if (rowlessError) {
          console.error('[persona-images] rollback rowless storage remove failed', {
            error: rowlessError,
            rowlessPaths,
          });
        } else {
          orphanPaths = [];
        }
      }
      if (retryError) {
        console.error('[persona-images] rollback row delete retry failed', { error: retryError });
        return { orphanPaths, rowBackedPaths: [...rowPaths] };
      }
    }
  }
  if (storedPaths.length > 0) {
    const { error: removeError } = await supabase.storage.from(IMAGE_BUCKET).remove(storedPaths);
    if (removeError) {
      console.error('[persona-images] rollback storage remove failed', {
        error: removeError,
        storedPaths,
      });
      return { orphanPaths: storedPaths, rowBackedPaths: [] };
    }
  }
  return empty;
}

/**
 * Retries removing orphaned upload storage paths once, then logs loudly if
 * the retry fails. Orphans are storage objects with no surviving DB row:
 * the internal rollback could not clean them up, so this call is the only
 * record of them. Shared by the persona-creation and image-upload error
 * paths so the retry-once semantics can't drift apart. Row-backed leftovers
 * are NOT touched here — their orchestration (log-only vs remove-after-
 * cascade) differs per route and stays at the call site.
 */
export async function removeOrphanedUploadPaths(
  supabase: SupabaseClient,
  orphanPaths: string[],
  logContext: Record<string, unknown>,
): Promise<void> {
  if (orphanPaths.length === 0) return;
  const { error } = await supabase.storage.from(IMAGE_BUCKET).remove(orphanPaths);
  if (error) {
    console.error('[persona-images] orphaned upload storage paths could not be removed', {
      ...logContext,
      orphanPaths,
      removeError: error,
    });
  }
}

/** Marks one library image as primary and unsets the flag on the others. */
export async function setPrimaryLibraryImage(
  supabase: SupabaseClient,
  personaId: string,
  imageId: string,
  userId: string,
): Promise<{ error: string; status: 404 | 500 } | null> {
  // The swap runs inside the set_primary_persona_image SQL function: it
  // locks the parent persona row and performs demote-then-promote
  // back-to-back, so concurrent swaps cannot interleave (two separate
  // UPDATEs from the app could transiently leave zero or two primaries).
  // p_user_id is the already-verified caller id (the route checked image
  // ownership via getOwnedImage); the function enforces it explicitly so
  // the service-role path does not rely on RLS.
  const { error } = await supabase.rpc('set_primary_persona_image', {
    p_persona_id: personaId,
    p_image_id: imageId,
    p_user_id: userId,
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
  userId: string,
): Promise<void> {
  const { error } = await supabase.rpc('record_persona_image_use', {
    p_persona_id: personaId,
    p_image_id: imageId,
    // The SQL function enforces ownership explicitly; the caller must pass
    // the already-verified user id (the route checked persona ownership).
    p_user_id: userId,
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
  | { ok: false; error: string; status: 404 | 500 }
> {
  // The user_id predicate is defense in depth: the route already verified
  // ownership, but with the service-role client this query must not read
  // another user's rows if a future caller ever skips that check.
  const { data, error } = await supabase
    .from('persona_images')
    .select('id, image_path, tag, description, is_primary')
    .eq('persona_id', personaId)
    .eq('user_id', userId)
    // Tie-break on id, matching the GET list's documented order exactly:
    // rows inserted in the same transaction can share a created_at, and
    // the deterministic "oldest first" fallback must agree with the UI's
    // displayed order about which image is "first".
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
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
