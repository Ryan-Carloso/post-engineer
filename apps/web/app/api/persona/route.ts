import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { isPersonaAllowed, isScopedApiKey } from '@/lib/api-keys';
import {
  parsePersonaForm,
  validateVisualCues,
  validateVoiceSource,
  photoExtensionOf,
  VALID_VIDEO_ASPECTS,
} from '@/lib/persona-schema';
import {
  addLibraryImages,
  setPrimaryLibraryImage,
  validateImageFile,
  MAX_PERSONA_IMAGES,
  type LibraryImageInput,
} from '@/lib/persona-images';

//---------------
// POST /api/persona — creates the user's persona:
// uploads photo/audio to the private 'personas' bucket on Supabase and
// inserts the record into public.personas (RLS by user_id).
// Validation = shared zod schema (lib/persona-schema.ts).
//---------------

function errorResponse(status: number, error: string): NextResponse {
  return NextResponse.json({ success: false, error }, { status });
}

export async function POST(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  if (isScopedApiKey(auth)) {
    return errorResponse(403, 'This API key is restricted to specific personas and cannot create new ones.');
  }
  const user = { id: auth.userId };
  const supabase = auth.isApiKey === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(400, 'Invalid multipart payload.');
  }
  const parsed = parsePersonaForm(formData, 'create');
  if (!parsed.ok) {
    return errorResponse(400, parsed.error);
  }
  const body = parsed.value;

  const hasPhoto = body.photo !== null;
  const hasAvatarUrl = body.values.avatarUrl !== null;
  const visualError = validateVisualCues(
    body.values.personaMode,
    body.values.faceMixPercent,
    hasPhoto,
    hasAvatarUrl,
  );
  if (visualError) {
    return errorResponse(400, visualError);
  }

  const voiceError = validateVoiceSource(body.values.voiceId);
  if (voiceError) {
    return errorResponse(400, voiceError);
  }

  // Optional image library at creation: `images` (files) with parallel
  // `imageTags` / `imageDescriptions` JSON arrays and an optional
  // `imagePrimaryIndex`. Pre-validated here so a bad file fails before any
  // upload or insert happens.
  const libraryFiles = formData
    .getAll('images')
    .filter((value): value is File => value instanceof File && value.size > 0);
  const libraryInputs: LibraryImageInput[] = libraryFiles.map((file, index) => ({
    file,
    tag: parseJsonStringArray(formData.get('imageTags'))[index] ?? '',
    description: parseJsonStringArray(formData.get('imageDescriptions'))[index] ?? '',
  }));
  const libraryError = validateLibraryInputs(
    body.values.personaMode,
    body.values.faceMixPercent,
    libraryInputs,
  );
  if (libraryError) {
    return errorResponse(400, libraryError);
  }

  const photoPath =
    body.photo && body.photoExtension
      ? await uploadFile(supabase, user.id, body.photo, body.photoExtension)
      : null;
  if (body.photo && !photoPath) {
    return errorResponse(500, 'Failed to upload photo.');
  }

  const { data: persona, error: insertError } = await supabase
    .from('personas')
    .insert({
      user_id: user.id,
      name: (body.values.name ?? '').trim(),
      photo_path: photoPath,
      avatar_url: body.values.avatarUrl,
      voice_id: body.values.voiceId,
      language: body.values.language,
      video_aspect: body.values.videoAspect,
      script_prompt: body.values.scriptPrompt,
      paragraph_number: body.values.paragraphNumber,
      niche: body.values.niche,
      face_mix_percent: body.values.faceMixPercent,
      face_quality: body.values.faceQuality,
    })
    .select('id')
    .single();

  if (insertError || !persona) {
    console.error('[api/persona] insert failed', { error: insertError });
    return errorResponse(500, 'Failed to create persona.');
  }

  let libraryImageIds: string[] = [];
  if (libraryInputs.length > 0) {
    const added = await addLibraryImages(supabase, user.id, persona.id, libraryInputs);
    if ('error' in added) {
      // Roll back the whole creation so a half-written persona never survives.
      // Rollback failures are logged loudly: an invisible failed rollback is
      // worse than a loud one.
      const { error: rollbackError } = await supabase
        .from('personas')
        .delete()
        .eq('id', persona.id);
      if (rollbackError) {
        console.error('[api/persona] creation rollback failed', { error: rollbackError });
      }
      if (photoPath) {
        const { error: photoRollbackError } = await supabase.storage
          .from('personas')
          .remove([photoPath]);
        if (photoRollbackError) {
          console.error('[api/persona] photo rollback failed', {
            error: photoRollbackError,
          });
        }
      }
      return errorResponse(added.status, added.error);
    }
    libraryImageIds = added.images.map((image) => image.id);
    const primaryIndex = parsePrimaryIndex(formData.get('imagePrimaryIndex'));
    if (primaryIndex !== null && primaryIndex < added.images.length) {
      const primaryError = await setPrimaryLibraryImage(
        supabase,
        persona.id,
        added.images[primaryIndex].id,
      );
      if (primaryError) {
        console.error('[api/persona] set primary library image failed', {
          error: primaryError.error,
        });
      }
    }
  }

  return NextResponse.json({ success: true, personaId: persona.id, imageIds: libraryImageIds });
}

//---------------
// parseJsonStringArray — reads an optional JSON array of strings from a
// multipart field (e.g. imageTags). Returns [] on missing/invalid input.
//---------------
function parseJsonStringArray(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

function parsePrimaryIndex(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const index = Number.parseInt(value, 10);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

//---------------
// validateLibraryInputs — library rules at creation:
// - faceless personas (or faceMixPercent 0) accept no images at all;
// - at most MAX_PERSONA_IMAGES files, each a valid image.
//---------------
function validateLibraryInputs(
  personaMode: 'persona' | 'faceless',
  faceMixPercent: number | null,
  inputs: LibraryImageInput[],
): string | null {
  if (inputs.length === 0) return null;
  if (personaMode === 'faceless' || faceMixPercent === 0) {
    return 'Faceless persona must not include library images.';
  }
  if (inputs.length > MAX_PERSONA_IMAGES) {
    return `Image library accepts at most ${MAX_PERSONA_IMAGES} images.`;
  }
  for (const input of inputs) {
    const validated = validateImageFile(input.file);
    if ('error' in validated) return validated.error;
  }
  return null;
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const user = { id: auth.userId };
  const supabase = auth.isApiKey === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  const personaId = new URL(request.url).searchParams.get('personaId');
  if (!personaId) return errorResponse(400, 'personaId is required.');
  if (!isPersonaAllowed(auth.personaIds, personaId)) {
    return errorResponse(403, 'This API key does not have access to this persona.');
  }

  const parsedPatch = await parsePatchBody(request);
  if (!parsedPatch.ok) return errorResponse(400, parsedPatch.error);
  const patch = parsedPatch.value;

  const { data: persona, error: selectError } = await supabase
    .from('personas')
    .select('id, name, photo_path, avatar_url, voice_id, voice_audio_path')
    .eq('id', personaId)
    .eq('user_id', user.id)
    .single();
  if (selectError || !persona) return errorResponse(404, 'Persona not found.');

  const updates: Record<string, unknown> = {};
  const stalePaths: string[] = [];

  if (patch.name !== null) {
    updates.name = patch.name.trim();
  }

  if (patch.photo && patch.photoExtension) {
    const photoPath = await uploadFile(supabase, user.id, patch.photo, patch.photoExtension);
    if (!photoPath) return errorResponse(500, 'Failed to upload photo.');
    updates.photo_path = photoPath;
    updates.avatar_url = null;
    if (typeof persona.photo_path === 'string' && persona.photo_path) {
      stalePaths.push(persona.photo_path);
    }
  } else if (patch.avatarUrl !== null) {
    updates.avatar_url = patch.avatarUrl;
    if (typeof persona.photo_path === 'string' && persona.photo_path) {
      stalePaths.push(persona.photo_path);
    }
  }

  if (patch.voiceId !== null) {
    updates.voice_id = patch.voiceId;
    updates.voice_audio_path = null;
    if (typeof persona.voice_audio_path === 'string' && persona.voice_audio_path) {
      stalePaths.push(persona.voice_audio_path);
    }
  }

  if (patch.language !== null) updates.language = patch.language;
  if (patch.videoAspect !== null) updates.video_aspect = patch.videoAspect;
  if (patch.scriptPrompt !== null) updates.script_prompt = patch.scriptPrompt;
  if (patch.paragraphNumber !== null) updates.paragraph_number = patch.paragraphNumber;
  if (patch.niche !== null) updates.niche = patch.niche;

  if (Object.keys(updates).length === 0) {
    return errorResponse(400, 'Nothing to update.');
  }

  const { error: updateError } = await supabase
    .from('personas')
    .update(updates)
    .eq('id', personaId);
  if (updateError) {
    console.error('[api/persona] update failed', { error: updateError });
    return errorResponse(500, 'Failed to update persona.');
  }

  if (stalePaths.length > 0) {
    const { error: storageError } = await supabase.storage.from('personas').remove(stalePaths);
    if (storageError) {
      console.error('[api/persona] storage cleanup failed', { error: storageError });
    }
  }

  return NextResponse.json({ success: true });
}

//---------------
// parsePatchBody — all fields are optional on edit; returns
// null for the ones missing from the multipart body.
//---------------
interface PersonaPatchBody {
  name: string | null;
  photo: File | null;
  photoExtension: string | null;
  avatarUrl: string | null;
  voiceId: string | null;
  language: string | null;
  videoAspect: string | null;
  scriptPrompt: string | null;
  paragraphNumber: number | null;
  niche: string | null;
}

type ParsePatchResult =
  | { ok: true; value: PersonaPatchBody }
  | { ok: false; error: string };

async function parsePatchBody(request: Request): Promise<ParsePatchResult> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return { ok: false, error: 'Invalid multipart payload.' };
  }

  const rawName = formData.get('name');
  const name = typeof rawName === 'string' && rawName.trim().length > 0 ? rawName : null;

  const avatarUrl = optionalString(formData.get('avatarUrl'));
  const voiceId = optionalString(formData.get('voiceId'));

  const photo = asFile(formData.get('photo'));
  const photoExtension = photoExtensionOf(photo);
  if (photo && !photoExtension) {
    return { ok: false, error: `Unsupported photo format: ${photo.type}` };
  }

  const language = optionalString(formData.get('language'));
  const videoAspect = optionalString(formData.get('videoAspect'));
  if (videoAspect !== null && !VALID_VIDEO_ASPECTS.includes(videoAspect as (typeof VALID_VIDEO_ASPECTS)[number])) {
    return { ok: false, error: `Invalid videoAspect: ${videoAspect}. Use one of ${VALID_VIDEO_ASPECTS.join(', ')}.` };
  }
  const scriptPrompt = optionalString(formData.get('scriptPrompt'));
  const niche = optionalString(formData.get('niche'));
  if (niche !== null && niche.length > 300) {
    return { ok: false, error: 'Invalid niche: use at most 300 characters.' };
  }
  const paragraphNumberRaw = optionalString(formData.get('paragraphNumber'));
  let paragraphNumber: number | null = null;
  if (paragraphNumberRaw !== null) {
    const parsedNumber = Number.parseInt(paragraphNumberRaw, 10);
    if (!Number.isInteger(parsedNumber) || parsedNumber < 1 || parsedNumber > 10) {
      return { ok: false, error: 'Invalid paragraphNumber: use an integer between 1 and 10.' };
    }
    paragraphNumber = parsedNumber;
  }

  return {
    ok: true,
    value: {
      name,
      photo,
      photoExtension,
      avatarUrl,
      voiceId,
      language,
      videoAspect,
      scriptPrompt,
      paragraphNumber,
      niche,
    },
  };
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const user = { id: auth.userId };
  const supabase = auth.isApiKey === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  const personaId = new URL(request.url).searchParams.get('personaId');
  if (!personaId) return errorResponse(400, 'personaId is required.');
  if (!isPersonaAllowed(auth.personaIds, personaId)) {
    return errorResponse(403, 'This API key does not have access to this persona.');
  }

  const { data: persona, error: selectError } = await supabase
    .from('personas')
    .select('id, photo_path, voice_audio_path')
    .eq('id', personaId)
    .eq('user_id', user.id)
    .single();
  if (selectError || !persona) return errorResponse(404, 'Persona not found.');

  const paths = [persona.photo_path, persona.voice_audio_path].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from('personas').remove(paths);
    if (storageError) {
      console.error('[api/persona] storage cleanup failed', { error: storageError });
      return errorResponse(500, 'Failed to remove persona files.');
    }
  }

  const { error: deleteError } = await supabase
    .from('personas')
    .delete()
    .eq('id', personaId)
    .eq('user_id', user.id);
  if (deleteError) {
    console.error('[api/persona] delete failed', { error: deleteError });
    return errorResponse(500, 'Failed to delete persona.');
  }
  return NextResponse.json({ success: true });
}

//---------------
// isFilePart — files come from the server runtime (undici), whose File
// is not the same constructor as the test environment's; structural check.
//---------------
function isFilePart(value: FormDataEntryValue | null): value is File {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.type === 'string' &&
    typeof candidate.size === 'number' &&
    candidate.arrayBuffer instanceof Function
  );
}

function asFile(value: FormDataEntryValue | null): File | null {
  return isFilePart(value) ? value : null;
}

function optionalString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return value;
}

//---------------
// uploadFile — uploads the file to the 'personas' bucket under the user's folder.
// Exportada para reuso por outras rotas de persona.
//---------------
export async function uploadFile(
  supabase: SupabaseClient,
  userId: string,
  file: File,
  extension: string,
): Promise<string | null> {
  const path = `${userId}/${randomUUID()}.${extension}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await supabase.storage.from('personas').upload(path, bytes, {
    contentType: file.type,
  });

  if (error) {
    console.error('[api/persona] storage upload failed', { path, error });
    return null;
  }
  return path;
}
