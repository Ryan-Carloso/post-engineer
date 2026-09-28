import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { isPersonaAllowed } from '@/lib/api-keys';
import {
  addLibraryImages,
  isFileLike,
  MAX_DESCRIPTION_LENGTH,
  MAX_TAG_LENGTH,
  setPrimaryLibraryImage,
} from '@/lib/persona-images';
import { type PersonaLibraryImage } from '@/lib/persona-image-select';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

//---------------
// /api/persona/images — persona image library.
//
// GET    ?personaId=  — list the persona's library images
// POST   multipart    — upload an image (personaId, image, tag?, description?, isPrimary?)
// PATCH  json         — update tag/description/isPrimary ({ id, tag?, description?, isPrimary? })
// DELETE ?id=         — remove the image (also deletes the storage file)
//---------------

function errorResponse(status: number, error: string): NextResponse {
  return NextResponse.json({ success: false, error }, { status });
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
    return { response: errorResponse(401, 'Authentication required.') };
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

/** Confirms the persona exists and belongs to the caller. */
async function assertPersonaOwned(
  supabase: SupabaseClient,
  auth: Authed,
  personaId: string,
): Promise<NextResponse | null> {
  if (!isPersonaAllowed(auth.personaIds, personaId)) {
    return errorResponse(403, 'This API key does not have access to this persona.');
  }
  const { data, error } = await supabase
    .from('personas')
    .select('id')
    .eq('id', personaId)
    .eq('user_id', auth.userId)
    .single();
  if (error || !data) return errorResponse(404, 'Persona not found.');
  return null;
}

/** Loads one library image and confirms it belongs to the caller. */
async function getOwnedImage(
  supabase: SupabaseClient,
  auth: Authed,
  imageId: string,
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
  if (error || !image) {
    return { image: null, error: errorResponse(404, 'Image not found.') };
  }
  const { data: persona, error: personaError } = await supabase
    .from('personas')
    .select('id')
    .eq('id', image.persona_id)
    .eq('user_id', auth.userId)
    .single();
  if (personaError || !persona) {
    return { image: null, error: errorResponse(404, 'Image not found.') };
  }
  if (!isPersonaAllowed(auth.personaIds, image.persona_id)) {
    return {
      image: null,
      error: errorResponse(403, 'This API key does not have access to this persona.'),
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
      .from('personas')
      .createSignedUrl(imagePath, 3600);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const authed = await getAuth(request);
  if ('response' in authed) return authed.response;
  const { auth, supabase } = authed;

  const personaId = new URL(request.url).searchParams.get('personaId');
  if (!personaId) return errorResponse(400, 'personaId is required.');
  const ownershipError = await assertPersonaOwned(supabase, auth, personaId);
  if (ownershipError) return ownershipError;

  const { data, error } = await supabase
    .from('persona_images')
    .select('id, image_path, tag, description, is_primary, created_at')
    .eq('persona_id', personaId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[api/persona/images] list failed', { error });
    return errorResponse(500, 'Failed to list images.');
  }
  // The bucket is private: the UI needs signed URLs to render thumbnails.
  const images = await Promise.all(
    ((data ?? []) as Array<{ image_path: string } & Record<string, unknown>>).map(
      async (row) => ({
        ...row,
        image_url: await signImageUrl(supabase, row.image_path),
      }),
    ),
  );
  return NextResponse.json({ success: true, images });
}

export async function POST(request: Request): Promise<NextResponse> {
  const authed = await getAuth(request);
  if ('response' in authed) return authed.response;
  const { auth, supabase } = authed;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(400, 'Invalid multipart payload.');
  }

  const personaId = formData.get('personaId');
  if (typeof personaId !== 'string' || personaId.length === 0) {
    return errorResponse(400, 'personaId is required.');
  }
  const ownershipError = await assertPersonaOwned(supabase, auth, personaId);
  if (ownershipError) return ownershipError;

  // Creation rejects library images for faceless personas; the same rule
  // applies here so images cannot be added backdoor after creation. Stored
  // facelessness is face_mix_percent = 0 (there is no persona_mode column).
  const { data: personaRow, error: facelessError } = await supabase
    .from('personas')
    .select('face_mix_percent')
    .eq('id', personaId)
    .single();
  if (facelessError) {
    console.error('[api/persona/images] faceless check failed', { error: facelessError });
    return errorResponse(500, 'Failed to verify persona.');
  }
  if (personaRow?.face_mix_percent === 0) {
    return errorResponse(400, 'Faceless persona must not include library images.');
  }

  const file = formData.get('image');
  if (!isFileLike(file) || file.size === 0) {
    return errorResponse(400, 'An image file is required.');
  }
  const tag = formData.get('tag');
  const description = formData.get('description');
  // The form field is a string: anything other than the exact 'true'/'false'
  // literals ('1', 'yes', 'True') is a client bug. Silently coercing to
  // false would confirm a primary the caller never got.
  const rawIsPrimary = formData.get('isPrimary');
  let isPrimary = false;
  if (rawIsPrimary !== null) {
    if (rawIsPrimary !== 'true' && rawIsPrimary !== 'false') {
      return errorResponse(400, "isPrimary must be 'true' or 'false'.");
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
    return errorResponse(added.status, added.error);
  }
  const image = added.images[0];
  if (isPrimary && image) {
    // Best-effort: the image row and storage object are already committed,
    // so a primary-flag failure must not turn this into a 500 while the
    // image exists. Log loudly and report the true is_primary state.
    const primaryError = await setPrimaryLibraryImage(supabase, personaId, image.id);
    if (primaryError) {
      console.error('[api/persona/images] primary flag after upload failed', {
        error: primaryError.error,
      });
    } else {
      image.is_primary = true;
    }
  }
  return NextResponse.json({ success: true, image }, { status: 201 });
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
    return errorResponse(400, 'id is required.');
  }
  const { image, error: ownershipError } = await getOwnedImage(supabase, auth, id);
  if (ownershipError) return ownershipError;

  const updates: Record<string, unknown> = {};
  if (typeof body === 'object' && body !== null) {
    const patch = body as { tag?: unknown; description?: unknown; isPrimary?: unknown };
    if (patch.tag !== undefined) {
      if (typeof patch.tag !== 'string') return errorResponse(400, 'tag must be a string.');
      if (patch.tag.trim().length > MAX_TAG_LENGTH) {
        return errorResponse(400, `tag must be at most ${MAX_TAG_LENGTH} characters.`);
      }
      updates.tag = patch.tag.trim();
    }
    if (patch.description !== undefined) {
      if (typeof patch.description !== 'string') {
        return errorResponse(400, 'description must be a string.');
      }
      if (patch.description.trim().length > MAX_DESCRIPTION_LENGTH) {
        return errorResponse(400, `description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`);
      }
      updates.description = patch.description.trim();
    }
    if (patch.isPrimary !== undefined) {
      if (typeof patch.isPrimary !== 'boolean') {
        return errorResponse(400, 'isPrimary must be a boolean.');
      }
      // Demoting to false is rejected: with no demote-only target the
      // library would end up with zero primary images, and every consumer
      // would fall back to nondeterministic selection. Set isPrimary: true
      // on the new image instead — the swap atomically demotes the old one.
      if (patch.isPrimary === false) {
        return errorResponse(
          400,
          'isPrimary cannot be set to false. Mark another image as primary instead.',
        );
      }
      updates.is_primary = patch.isPrimary;
    }
  }
  if (Object.keys(updates).length === 0) {
    return errorResponse(400, 'Nothing to update.');
  }

  if (updates.is_primary === true) {
    // Reuse the shared helper (with its error checks) instead of
    // reimplementing the unset-others swap inline.
    const personaId = image.persona_id;
    const primaryError = await setPrimaryLibraryImage(supabase, personaId, id);
    if (primaryError) return errorResponse(500, primaryError.error);
    delete updates.is_primary;
  }
  if (Object.keys(updates).length === 0) {
    // The primary flag was the only change and is already applied.
    // Mutations intentionally return the raw DB row (snake_case, no signed
    // image_url): every client invalidates ['persona-images', personaId] on
    // success and refetches the signed GET shape, so no consumer reads
    // image_url from a mutation payload. Signing here would pay a storage
    // round-trip per edit for nothing.
    const { data: current, error: fetchError } = await supabase
      .from('persona_images')
      .select('id, image_path, tag, description, is_primary, created_at')
      .eq('id', id)
      .single();
    if (fetchError || !current) {
      console.error('[api/persona/images] refetch after primary update failed', {
        error: fetchError,
      });
      return errorResponse(500, 'Failed to update image.');
    }
    return NextResponse.json({ success: true, image: current });
  }

  const { data: updated, error: updateError } = await supabase
    .from('persona_images')
    .update(updates)
    .eq('id', id)
    .select('id, image_path, tag, description, is_primary, created_at')
    .single();
  if (updateError || !updated) {
    console.error('[api/persona/images] update failed', { error: updateError });
    return errorResponse(500, 'Failed to update image.');
  }
  return NextResponse.json({ success: true, image: updated });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const authed = await getAuth(request);
  if ('response' in authed) return authed.response;
  const { auth, supabase } = authed;

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return errorResponse(400, 'id is required.');
  const { image, error: ownershipError } = await getOwnedImage(supabase, auth, id);
  if (ownershipError) return ownershipError;

  const { error: deleteError } = await supabase
    .from('persona_images')
    .delete()
    .eq('id', id);
  if (deleteError) {
    console.error('[api/persona/images] delete failed', { error: deleteError });
    return errorResponse(500, 'Failed to delete image.');
  }
  // Deleting the primary image intentionally leaves the library with zero
  // primaries: persona-image-select.ts falls back deterministically
  // (newest row first), and there is no safe implicit successor to promote.
  // Best-effort storage cleanup: the DB row is the source of truth, but a
  // failed remove must not go silently — otherwise orphaned objects pile up.
  const { error: storageError } = await supabase.storage
    .from('personas')
    .remove([image.image_path]);
  if (storageError) {
    console.error('[api/persona/images] storage cleanup failed', {
      imagePath: image.image_path,
      error: storageError,
    });
  }
  return NextResponse.json({ success: true });
}
