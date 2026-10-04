import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { isPersonaAllowed } from '@/lib/api-keys';
import { apiErrorResponse } from '@/lib/api-error';
import {
  addLibraryImages,
  IMAGE_BUCKET,
  IMAGE_URL_TTL_SECONDS,
  isFileLike,
  MAX_DESCRIPTION_LENGTH,
  MAX_TAG_LENGTH,
  PERSONA_IMAGE_WARNING_CODES,
  removeOrphanedUploadPaths,
  setPrimaryLibraryImage,
} from '@/lib/persona-images';
import { type PersonaLibraryImage } from '@/lib/persona-image-select';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/logger';

//---------------
// /api/persona/images — persona image library.
//
// GET    ?personaId=  — list the persona's library images
// POST   multipart    — upload an image (personaId, image, tag?, description?, isPrimary?)
// PATCH  json         — update tag/description/isPrimary ({ id, tag?, description?, isPrimary? })
// DELETE ?id=         — remove the image (also deletes the storage file)
//---------------

function errorResponse(
  status: number,
  error: string,
  route: string,
  options?: { cause?: unknown; logMessage?: string; metadata?: Record<string, unknown> },
): NextResponse {
  return apiErrorResponse(status, error, { route, ...options });
}

interface Authed {
  userId: string;
  isApiKey: boolean;
  personaIds: string[] | null;
}

async function getAuth(request: Request): Promise<
  { auth: Authed; supabase: SupabaseClient } | { response: NextResponse }
> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return { response: errorResponse(401, 'Authentication required.', `${request.method} /api/persona/images`) };
  }
  // NOTE: for API-key callers this is the service-role client, which bypasses
  // RLS. Ownership below is enforced by the application-level helpers
  // (assertPersonaOwned / getOwnedImage) — every handler in this file must
  // scope through one of them and must never query persona_images or storage
  // without it.
  const supabase =
    auth.isApiKey === true
      ? createSupabaseServiceClient()
      : await createSupabaseServerClient();
  return {
    auth: {
      userId: auth.userId,
      isApiKey: auth.isApiKey === true,
      personaIds: (auth.personaIds ?? null) as string[] | null,
    },
    supabase,
  };
}

interface OwnedRow extends PersonaLibraryImage {
  persona_id: string;
}

interface OwnedPersona {
  id: string;
}

/** Confirms the persona exists and belongs to the caller; returns the row. */
async function assertPersonaOwned(
  supabase: SupabaseClient,
  auth: Authed,
  personaId: string,
  method: string,
): Promise<{ response: NextResponse } | { persona: OwnedPersona }> {
  if (!isPersonaAllowed(auth.personaIds, personaId)) {
    return {
      response: errorResponse(403, 'This API key does not have access to this persona.', `${method} /api/persona/images`),
    };
  }
  const { data, error } = await supabase
    .from('personas')
    .select('id')
    .eq('id', personaId)
    .eq('user_id', auth.userId)
    .single();
  if (error) {
    // PGRST116 = .single() matched zero rows: the persona is missing or
    // belongs to someone else. Any other error is a real DB failure — a
    // bare 404 would tell the client to stop retrying and leave zero
    // diagnostic trail, so log it and report 500.
    if (error.code === 'PGRST116') {
      return { response: errorResponse(404, 'Persona not found.', `${method} /api/persona/images`) };
    }
    return { response: errorResponse(500, 'Failed to load persona.', `${method} /api/persona/images`, {
      cause: error,
      metadata: { personaId },
    }) };
  }
  if (!data) return { response: errorResponse(404, 'Persona not found.', `${method} /api/persona/images`) };
  return { persona: data as OwnedPersona };
}

/** Columns returned for a single library image row (GET list, PATCH, POST). */
const IMAGE_ROW_COLUMNS = 'id, image_path, tag, description, is_primary, created_at';

/**
 * Refetches one library image row. Shared by the PATCH primary-swap path
 * and the metadata-update path so the selected columns can't drift apart.
 */
async function fetchImageRow(
  supabase: SupabaseClient,
  id: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from('persona_images')
    .select(IMAGE_ROW_COLUMNS)
    .eq('id', id)
    .single();
  if (error || !data) {
    logger.error('[api/persona/images] image refetch failed', error);
    return null;
  }
  return data as Record<string, unknown>;
}

// Shared mutation-response shape: refetch the row and project it without
// image_path. Used by the primary-swap-only and metadata-partial-failure
// paths so the response shape can't drift apart. Both callers run after a
// primary swap already committed atomically.
function respondWithCurrentRow(
  current: Record<string, unknown> | null,
  warnings?: string[],
): NextResponse {
  if (!current) {
    // The swap committed, but the row could not be re-read: a bare 500
    // would tell the UI "nothing changed" and hide the committed primary
    // change. Report the honest partial state instead — the mutation hook
    // invalidates the library on success, so the UI refetches and converges
    // to the true state.
    return NextResponse.json({
      success: true,
      image: null,
      warnings: [...(warnings ?? []), PERSONA_IMAGE_WARNING_CODES.ROW_REFETCH_FAILED],
    });
  }
  return NextResponse.json({
    success: true,
    image: withoutImagePath(current),
    ...(warnings ? { warnings } : {}),
  });
}

/** Loads one library image and confirms it belongs to the caller. */
async function getOwnedImage(
  supabase: SupabaseClient,
  auth: Authed,
  imageId: string,
  method: string,
): Promise<
  | { image: OwnedRow; error: null }
  | { image: null; error: NextResponse }
> {
  const { data, error } = await supabase
    .from('persona_images')
    .select('id, persona_id, image_path, tag, description, is_primary')
    .eq('id', imageId)
    .single();
  const image = data as OwnedRow | null;
  if (error) {
    // Same PGRST116-vs-DB-failure split as assertPersonaOwned: zero rows
    // is 404, anything else is a logged 500.
    if (error.code === 'PGRST116') {
      return { image: null, error: errorResponse(404, 'Image not found.', `${method} /api/persona/images`) };
    }
    return { image: null, error: errorResponse(500, 'Failed to load image.', `${method} /api/persona/images`, {
      cause: error,
      metadata: { imageId },
    }) };
  }
  if (!image) {
    return { image: null, error: errorResponse(404, 'Image not found.', `${method} /api/persona/images`) };
  }
  const { data: persona, error: personaError } = await supabase
    .from('personas')
    .select('id')
    .eq('id', image.persona_id)
    .eq('user_id', auth.userId)
    .single();
  if (personaError) {
    if (personaError.code === 'PGRST116') {
      return { image: null, error: errorResponse(404, 'Image not found.', `${method} /api/persona/images`) };
    }
    return { image: null, error: errorResponse(500, 'Failed to load image.', `${method} /api/persona/images`, {
      cause: personaError,
      metadata: { imageId },
    }) };
  }
  if (!persona) {
    return { image: null, error: errorResponse(404, 'Image not found.', `${method} /api/persona/images`) };
  }
  if (!isPersonaAllowed(auth.personaIds, image.persona_id)) {
    return {
      image: null,
      error: errorResponse(403, 'This API key does not have access to this persona.', `${method} /api/persona/images`),
    };
  }
  return { image, error: null };
}

/** Signs one library image path; null when signing fails (never throws). */
async function signImageUrl(
  supabase: SupabaseClient,
  imagePath: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from(IMAGE_BUCKET)
      .createSignedUrl(imagePath, IMAGE_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      logger.warn('[api/persona/images] failed to sign storage URL', { imagePath, error });
      return null;
    }
    return data.signedUrl;
  } catch (error) {
    logger.warn('[api/persona/images] failed to sign storage URL', { imagePath, error });
    return null;
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const authed = await getAuth(request);
  if ('response' in authed) return authed.response;
  const { auth, supabase } = authed;

  const personaId = new URL(request.url).searchParams.get('personaId');
  if (!personaId) return errorResponse(400, 'personaId is required.', 'GET /api/persona/images');
  const owned = await assertPersonaOwned(supabase, auth, personaId, 'GET');
  if ('response' in owned) return owned.response;

  const { data, error } = await supabase
    .from('persona_images')
    .select(IMAGE_ROW_COLUMNS)
    .eq('persona_id', personaId)
    // Tie-break on id: rows inserted in the same transaction can share a
    // created_at, and the deterministic "oldest first" fallback must match
    // resolveVideoImage's order exactly.
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) {
    return errorResponse(500, 'Failed to list images.', 'GET /api/persona/images', {
      cause: error,
    });
  }
  // The bucket is private: the UI needs signed URLs to render thumbnails.
  // Project only the fields the UI needs; the internal storage path
  // (image_path) is not exposed to the browser. A failed sign is surfaced
  // as a warning so the UI can distinguish "no URL" from a transient
  // signing failure and show a retryable error state.
  const images = await Promise.all(
    ((data ?? []) as Array<{ image_path: string } & Record<string, unknown>>).map(
      async (row) => {
        const image_url = await signImageUrl(supabase, row.image_path);
        return {
          id: row.id,
          tag: row.tag,
          description: row.description,
          is_primary: row.is_primary,
          created_at: row.created_at,
          image_url,
          ...(image_url === null ? { image_url_error: true as const } : {}),
        };
      },
    ),
  );
  return NextResponse.json({ success: true, images });
}

// Strip the internal storage path from a mutation response row.
function withoutImagePath(row: Record<string, unknown> | PersonaLibraryImage): Record<string, unknown> {
  const { image_path: _omitted, ...safe } = row as Record<string, unknown>;
  return safe;
}

export async function POST(request: Request): Promise<NextResponse> {
  // Gate the expensive upload surface (storage write + magic-byte read +
  // row insert per request), mirroring upload-content and video-job.
  const limited = await applyRateLimit(request, RATE_LIMITS.mediaUpload);
  if (limited) return limited;

  const authed = await getAuth(request);
  if ('response' in authed) return authed.response;
  const { auth, supabase } = authed;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(400, 'Invalid multipart payload.', 'POST /api/persona/images');
  }

  const personaId = formData.get('personaId');
  if (typeof personaId !== 'string' || personaId.length === 0) {
    return errorResponse(400, 'personaId is required.', 'POST /api/persona/images');
  }
  const owned = await assertPersonaOwned(supabase, auth, personaId, 'POST');
  if ('response' in owned) return owned.response;

  const file = formData.get('image');
  if (!isFileLike(file) || file.size === 0) {
    return errorResponse(400, 'An image file is required.', 'POST /api/persona/images');
  }
  const tag = formData.get('tag');
  const description = formData.get('description');
  // Like isPrimary and PATCH: a non-string tag/description is a client bug.
  // Silently coercing a File to '' would lose the caller's metadata with a
  // 201; fail loudly instead. Missing fields are fine (they default to '').
  if (tag !== null && typeof tag !== 'string') {
    return errorResponse(400, 'tag must be a string.', 'POST /api/persona/images');
  }
  if (description !== null && typeof description !== 'string') {
    return errorResponse(400, 'description must be a string.', 'POST /api/persona/images');
  }
  // The form field is a string: anything other than the exact 'true'/'false'
  // literals ('1', 'yes', 'True') is a client bug. Silently coercing to
  // false would confirm a primary the caller never got.
  const rawIsPrimary = formData.get('isPrimary');
  let isPrimary = false;
  if (rawIsPrimary !== null) {
    if (rawIsPrimary !== 'true' && rawIsPrimary !== 'false') {
      return errorResponse(400, "isPrimary must be 'true' or 'false'.", 'POST /api/persona/images');
    }
    isPrimary = rawIsPrimary === 'true';
  }

  const added = await addLibraryImages(supabase, auth.userId, personaId, [
    {
      file,
      tag: typeof tag === 'string' ? tag : '',
      description: typeof description === 'string' ? description : '',
    },
  ]);
  if ('error' in added) {
    const { orphanPaths, rowBackedPaths } = added.leftoverPaths ?? {
      orphanPaths: [],
      rowBackedPaths: [],
    };
    // Only orphanPaths are safe to remove: rowBackedPaths still have
    // surviving rows, and deleting their files would dangle those rows.
    // Log row-backed leftovers loudly — they need manual cleanup.
    if (rowBackedPaths.length > 0) {
      logger.error('[api/persona/images] upload rollback left row-backed image paths', undefined, {
        personaId,
        rowBackedPaths,
      });
    }
    // The internal rollback could not clean up the orphans: retry once via
    // the shared helper, which logs loudly if the retry still fails.
    await removeOrphanedUploadPaths(supabase, orphanPaths, {
      route: 'api/persona/images',
      personaId,
    });
    return errorResponse(added.status, added.error, 'POST /api/persona/images');
  }
  const image = added.images[0];
  const warnings: string[] = [];
  if (isPrimary && image) {
    // Best-effort: the image row and storage object are already committed,
    // so a primary-flag failure must not turn this into a 500 while the
    // image exists. Log loudly and report the true is_primary state with a
    // warning, mirroring the PATCH partial-success contract. Warnings are
    // stable codes, not English copy: the UI maps them through i18n.
    const primaryError = await setPrimaryLibraryImage(supabase, personaId, image.id, auth.userId);
    if (primaryError) {
      logger.error('[api/persona/images] primary flag after upload failed', primaryError.error);
      warnings.push(PERSONA_IMAGE_WARNING_CODES.PRIMARY_SWAP_FAILED);
    } else {
      image.is_primary = true;
    }
  }
  // Strip the internal storage path: the GET invariant (project only
  // UI-needed fields) applies to mutations too. No consumer reads the
  // image row from mutation payloads (ImageMutationResult has no image).
  return NextResponse.json(
    { success: true, image: withoutImagePath(image), ...(warnings.length > 0 ? { warnings } : {}) },
    { status: 201 },
  );
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const authed = await getAuth(request);
  if ('response' in authed) return authed.response;
  const { auth, supabase } = authed;

  const body: unknown = await request.json().catch(() => null);
  const id =
    typeof body === 'object' && body !== null && 'id' in body
      ? (body as { id: unknown }).id
      : undefined;
  if (typeof id !== 'string' || id.length === 0) {
    return errorResponse(400, 'id is required.', 'PATCH /api/persona/images');
  }
  const { image, error: ownershipError } = await getOwnedImage(supabase, auth, id, 'PATCH');
  if (ownershipError) return ownershipError;

  const updates: Record<string, unknown> = {};
  if (typeof body === 'object' && body !== null) {
    const patch = body as { tag?: unknown; description?: unknown; isPrimary?: unknown };
    if (patch.tag !== undefined) {
      if (typeof patch.tag !== 'string') return errorResponse(400, 'tag must be a string.', 'PATCH /api/persona/images');
      if (patch.tag.trim().length > MAX_TAG_LENGTH) {
        return errorResponse(400, `tag must be at most ${MAX_TAG_LENGTH} characters.`, 'PATCH /api/persona/images');
      }
      updates.tag = patch.tag.trim();
    }
    if (patch.description !== undefined) {
      if (typeof patch.description !== 'string') {
        return errorResponse(400, 'description must be a string.', 'PATCH /api/persona/images');
      }
      if (patch.description.trim().length > MAX_DESCRIPTION_LENGTH) {
        return errorResponse(400, `description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`, 'PATCH /api/persona/images');
      }
      updates.description = patch.description.trim();
    }
    if (patch.isPrimary !== undefined) {
      if (typeof patch.isPrimary !== 'boolean') {
        return errorResponse(400, 'isPrimary must be a boolean.', 'PATCH /api/persona/images');
      }
      // Demoting to false is rejected: with no demote-only target the
      // library would end up with zero primary images, and every consumer
      // would fall back to nondeterministic selection. Set isPrimary: true
      // on the new image instead — the swap atomically demotes the old one.
      if (patch.isPrimary === false) {
        return errorResponse(
          400,
          'isPrimary cannot be set to false. Mark another image as primary instead.', 'PATCH /api/persona/images',
        );
      }
      updates.is_primary = patch.isPrimary;
    }
  }
  if (Object.keys(updates).length === 0) {
    return errorResponse(400, 'Nothing to update.', 'PATCH /api/persona/images');
  }

  // The warning-style success below is only honest when a primary swap
  // actually committed in this PATCH. A metadata-only failure keeps the
  // original 500 — claiming "Primary image was updated" then would be a lie.
  let primarySwapCommitted = false;
  // isPrimary === false is rejected with 400 above, so reaching here with
  // updates.is_primary set means true; the strict check documents that.
  if (updates.is_primary === true) {
    // Reuse the shared helper (with its error checks) instead of
    // reimplementing the unset-others swap inline.
    const personaId = image.persona_id;
    const primaryError = await setPrimaryLibraryImage(supabase, personaId, id, auth.userId);
    if (primaryError) return errorResponse(primaryError.status, primaryError.error, 'PATCH /api/persona/images');
    primarySwapCommitted = true;
    delete updates.is_primary;
  }
  if (Object.keys(updates).length === 0) {
    // The primary flag was the only change and is already applied.
    // Mutations intentionally return the raw DB row (snake_case, no signed
    // image_url): every client invalidates ['persona-images', personaId] on
    // success and refetches the signed GET shape, so no consumer reads
    // image_url from a mutation payload. Signing here would pay a storage
    // round-trip per edit for nothing.
    const current = await fetchImageRow(supabase, id);
    return respondWithCurrentRow(current);
  }

  const { data: updated, error: updateError } = await supabase
    .from('persona_images')
    .update(updates)
    .eq('id', id)
    // Re-scope by persona_id: the id was ownership-checked above and image
    // rows never change owner, but this makes the TOCTOU window explicit —
    // a concurrently deleted row yields zero rows, not someone else's row.
    .eq('persona_id', image.persona_id)
    .select(IMAGE_ROW_COLUMNS)
    .single();
  if (updateError || !updated) {
    logger.error('[api/persona/images] update failed', updateError);
    // PGRST116 = the row vanished between the ownership check and the
    // update (concurrent delete): report 404, not 500.
    const rowGone = updateError?.code === 'PGRST116';
    if (rowGone && !primarySwapCommitted) {
      return errorResponse(404, 'Image not found.', 'PATCH /api/persona/images');
    }
    if (!primarySwapCommitted) {
      return errorResponse(500, 'Failed to update image.', 'PATCH /api/persona/images');
    }
    // The primary swap above already committed atomically: a 500 here would
    // hide that from the caller. Report the true row state with a warning
    // instead, mirroring the POST best-effort path — retrying the metadata
    // update is safe.
    const current = await fetchImageRow(supabase, id);
    // Stable code, not English copy: the UI maps it through i18n.
    return respondWithCurrentRow(current, [PERSONA_IMAGE_WARNING_CODES.METADATA_SAVE_FAILED]);
  }
  return NextResponse.json({ success: true, image: withoutImagePath(updated) });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const authed = await getAuth(request);
  if ('response' in authed) return authed.response;
  const { auth, supabase } = authed;

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return errorResponse(400, 'id is required.', 'DELETE /api/persona/images');
  const { image, error: ownershipError } = await getOwnedImage(supabase, auth, id, 'DELETE');
  if (ownershipError) return ownershipError;

  const { error: deleteError } = await supabase
    .from('persona_images')
    .delete()
    .eq('id', id);
  if (deleteError) {
    return errorResponse(500, 'Failed to delete image.', 'DELETE /api/persona/images', {
      cause: deleteError,
    });
  }
  // Deleting the primary image intentionally leaves the library with zero
  // primaries: persona-image-select.ts falls back deterministically (oldest
  // row first — resolveVideoImage orders by created_at ascending), and there
  // is no safe implicit successor to promote.
  // Best-effort storage cleanup: the DB row is the source of truth, but a
  // failed remove must not go silently — otherwise orphaned objects pile up.
  // One retry mirrors the rollback paths in lib/persona-images.ts.
  const { error: storageError } = await supabase.storage
    .from(IMAGE_BUCKET)
    .remove([image.image_path]);
  if (storageError) {
    const retry = await supabase.storage.from(IMAGE_BUCKET).remove([image.image_path]);
    if (retry.error) {
      logger.error('[api/persona/images] storage cleanup failed', undefined, {
        imagePath: image.image_path,
        error: retry.error,
      });
    }
  }
  return NextResponse.json({ success: true });
}
