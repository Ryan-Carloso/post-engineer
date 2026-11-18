import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { isPersonaAllowed } from '@/lib/api-keys';
import { apiErrorResponse } from '@/lib/api-error';
import { forwardLibraryImagesError, personaValidationError } from '../validation-error';
import {
  addLibraryImages,
  IMAGE_BUCKET,
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
import { parseDeletePersonaImageQuery, parseListPersonaImagesQuery } from '@/lib/contracts/personas';
import { signImageUrl } from './sign-image-url';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

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
  const supabase =
    auth.isApiKey === true || auth.isOAuth === true
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

const IMAGE_ROW_COLUMNS = 'id, image_path, tag, description, is_primary, created_at';

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

function respondWithCurrentRow(
  current: Record<string, unknown> | null,
  warnings?: string[],
): NextResponse {
  if (!current) {
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

async function getHandler(request: Request): Promise<NextResponse> {
  const authed = await getAuth(request);
  if ('response' in authed) return authed.response;
  const { auth, supabase } = authed;

  const parsedPersonaId = parseListPersonaImagesQuery(request.url);
  if (!parsedPersonaId.ok) return personaValidationError(parsedPersonaId.error, 'GET /api/persona/images', { field: 'personaId' });
  const personaId = parsedPersonaId.query.personaId;
  const owned = await assertPersonaOwned(supabase, auth, personaId, 'GET');
  if ('response' in owned) return owned.response;

  const { data, error } = await supabase
    .from('persona_images')
    .select(IMAGE_ROW_COLUMNS)
    .eq('persona_id', personaId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) {
    return errorResponse(500, 'Failed to list images.', 'GET /api/persona/images', {
      cause: error,
    });
  }
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

function withoutImagePath(row: Record<string, unknown> | PersonaLibraryImage): Record<string, unknown> {
  const { image_path: _omitted, ...safe } = row as Record<string, unknown>;
  return safe;
}

async function postHandler(request: Request): Promise<NextResponse> {
  const limited = await applyRateLimit(request, RATE_LIMITS.mediaUpload);
  if (limited) return limited;

  const authed = await getAuth(request);
  if ('response' in authed) return authed.response;
  const { auth, supabase } = authed;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return personaValidationError('Invalid multipart payload.', 'POST /api/persona/images');
  }

  const personaId = formData.get('personaId');
  if (typeof personaId !== 'string' || personaId.length === 0) {
    return personaValidationError('personaId is required.', 'POST /api/persona/images', { field: 'personaId' });
  }
  const owned = await assertPersonaOwned(supabase, auth, personaId, 'POST');
  if ('response' in owned) return owned.response;

  const file = formData.get('image');
  if (!isFileLike(file) || file.size === 0) {
    return personaValidationError('An image file is required.', 'POST /api/persona/images', { field: 'file' });
  }
  const tag = formData.get('tag');
  const description = formData.get('description');
  if (tag !== null && typeof tag !== 'string') {
    return personaValidationError('tag must be a string.', 'POST /api/persona/images', { field: 'tag' });
  }
  if (description !== null && typeof description !== 'string') {
    return personaValidationError('description must be a string.', 'POST /api/persona/images', { field: 'description' });
  }
  const rawIsPrimary = formData.get('isPrimary');
  let isPrimary = false;
  if (rawIsPrimary !== null) {
    if (rawIsPrimary !== 'true' && rawIsPrimary !== 'false') {
      return personaValidationError("isPrimary must be 'true' or 'false'.", 'POST /api/persona/images', { field: 'isPrimary' });
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
    if (rowBackedPaths.length > 0) {
      logger.error('[api/persona/images] upload rollback left row-backed image paths', undefined, {
        personaId,
        rowBackedPaths,
      });
    }
    await removeOrphanedUploadPaths(supabase, orphanPaths, {
      route: 'api/persona/images',
      personaId,
    });
    return forwardLibraryImagesError(added, 'POST /api/persona/images');
  }
  const image = added.images[0];
  const warnings: string[] = [];
  if (isPrimary && image) {
    const primaryError = await setPrimaryLibraryImage(supabase, personaId, image.id, auth.userId);
    if (primaryError) {
      logger.error('[api/persona/images] primary flag after upload failed', primaryError.error);
      warnings.push(PERSONA_IMAGE_WARNING_CODES.PRIMARY_SWAP_FAILED);
    } else {
      image.is_primary = true;
    }
  }
  return NextResponse.json(
    { success: true, image: withoutImagePath(image), ...(warnings.length > 0 ? { warnings } : {}) },
    { status: 201 },
  );
}

async function patchHandler(request: Request): Promise<NextResponse> {
  const authed = await getAuth(request);
  if ('response' in authed) return authed.response;
  const { auth, supabase } = authed;

  const body: unknown = await request.json().catch(() => null);
  const id =
    typeof body === 'object' && body !== null && 'id' in body
      ? (body as { id: unknown }).id
      : undefined;
  if (typeof id !== 'string' || id.length === 0) {
    return personaValidationError('id is required.', 'PATCH /api/persona/images', { field: 'id' });
  }
  const { image, error: ownershipError } = await getOwnedImage(supabase, auth, id, 'PATCH');
  if (ownershipError) return ownershipError;

  const updates: Record<string, unknown> = {};
  if (typeof body === 'object' && body !== null) {
    const patch = body as { tag?: unknown; description?: unknown; isPrimary?: unknown };
    if (patch.tag !== undefined) {
      if (typeof patch.tag !== 'string') return personaValidationError('tag must be a string.', 'PATCH /api/persona/images', { field: 'tag' });
      if (patch.tag.trim().length > MAX_TAG_LENGTH) {
        return personaValidationError(`tag must be at most ${MAX_TAG_LENGTH} characters.`, 'PATCH /api/persona/images', { field: 'tag' });
      }
      updates.tag = patch.tag.trim();
    }
    if (patch.description !== undefined) {
      if (typeof patch.description !== 'string') {
        return personaValidationError('description must be a string.', 'PATCH /api/persona/images', { field: 'description' });
      }
      if (patch.description.trim().length > MAX_DESCRIPTION_LENGTH) {
        return personaValidationError(`description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`, 'PATCH /api/persona/images', { field: 'description' });
      }
      updates.description = patch.description.trim();
    }
    if (patch.isPrimary !== undefined) {
      if (typeof patch.isPrimary !== 'boolean') {
        return personaValidationError('isPrimary must be a boolean.', 'PATCH /api/persona/images', { field: 'isPrimary' });
      }
      if (patch.isPrimary === false) {
        const message = 'isPrimary cannot be set to false. Mark another image as primary instead.';
        return personaValidationError(message, 'PATCH /api/persona/images', { field: 'isPrimary' });
      }
      updates.is_primary = patch.isPrimary;
    }
  }
  if (Object.keys(updates).length === 0) {
    return personaValidationError('Nothing to update.', 'PATCH /api/persona/images');
  }

  let primarySwapCommitted = false;
  if (updates.is_primary === true) {
    const personaId = image.persona_id;
    const primaryError = await setPrimaryLibraryImage(supabase, personaId, id, auth.userId);
    if (primaryError) return errorResponse(primaryError.status, primaryError.error, 'PATCH /api/persona/images');
    primarySwapCommitted = true;
    delete updates.is_primary;
  }
  if (Object.keys(updates).length === 0) {
    const current = await fetchImageRow(supabase, id);
    return respondWithCurrentRow(current);
  }

  const { data: updated, error: updateError } = await supabase
    .from('persona_images')
    .update(updates)
    .eq('id', id)
    .eq('persona_id', image.persona_id)
    .select(IMAGE_ROW_COLUMNS)
    .single();
  if (updateError || !updated) {
    logger.error('[api/persona/images] update failed', updateError);
    const rowGone = updateError?.code === 'PGRST116';
    if (rowGone && !primarySwapCommitted) {
      return errorResponse(404, 'Image not found.', 'PATCH /api/persona/images');
    }
    if (!primarySwapCommitted) {
      return errorResponse(500, 'Failed to update image.', 'PATCH /api/persona/images');
    }
    const current = await fetchImageRow(supabase, id);
    return respondWithCurrentRow(current, [PERSONA_IMAGE_WARNING_CODES.METADATA_SAVE_FAILED]);
  }
  return NextResponse.json({ success: true, image: withoutImagePath(updated) });
}

async function deleteHandler(request: Request): Promise<NextResponse> {
  const authed = await getAuth(request);
  if ('response' in authed) return authed.response;
  const { auth, supabase } = authed;

  const parsedId = parseDeletePersonaImageQuery(request.url);
  if (!parsedId.ok) return personaValidationError(parsedId.error, 'DELETE /api/persona/images', { field: 'id' });
  const id = parsedId.query.id;
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

export const GET = withApiErrorReporting('GET /api/persona/images', getHandler, { getUserId: resolveReportingUserId });
export const POST = withApiErrorReporting('POST /api/persona/images', postHandler, { getUserId: resolveReportingUserId });
export const DELETE = withApiErrorReporting('DELETE /api/persona/images', deleteHandler, { getUserId: resolveReportingUserId });
export const PATCH = withApiErrorReporting('PATCH /api/persona/images', patchHandler, { getUserId: resolveReportingUserId });
