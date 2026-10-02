import { randomUUID } from 'crypto';
import { NextResponse, after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';
import { isPersonaAllowed, isScopedApiKey } from '@/lib/api-keys';
import {
  parsePersonaForm,
  validateVisualCues,
  validateVoiceSource,
  photoExtensionOf,
  resolveStoredFaceMixPercent,
  VALID_VIDEO_ASPECTS,
} from '@/lib/persona-schema';
import {
  addLibraryImages,
  IMAGE_BUCKET,
  isFileLike,
  readValidatedImage,
  removeOrphanedUploadPaths,
  setPrimaryLibraryImage,
  validateImageFile,
  MAX_PERSONA_IMAGES,
  PERSONA_IMAGE_WARNING_CODES,
  type LibraryImageInput,
} from '@/lib/persona-images';
import { logger } from '@/lib/logger';
import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES } from '@/lib/error-codes';
import { trackApiEvent } from '@/lib/analytics';
import { SAFE_TASK_ID } from '@/lib/video-urls';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

// Aggregate budget for the post-delete engine task cleanup (see DELETE):
// after() has no deadline of its own, so the loop must bound itself.
const ENGINE_CLEANUP_BUDGET_MS = 20_000;

//---------------
// POST /api/persona — creates the user's persona:
// uploads photo/audio to the private 'personas' bucket on Supabase and
// inserts the record into public.personas (RLS by user_id).
// Validation = shared zod schema (lib/persona-schema.ts).
//---------------

function errorResponse(
  status: number,
  error: string,
  route: string,
  options?: { cause?: unknown; logMessage?: string; metadata?: Record<string, unknown> },
): NextResponse {
  return apiErrorResponse(status, error, { route, ...options });
}

export async function POST(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  if (isScopedApiKey(auth)) {
    return errorResponse(403, 'This API key is restricted to specific personas and cannot create new ones.', 'POST /api/persona');
  }
  const user = { id: auth.userId };
  const supabase = auth.isApiKey === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(400, 'Invalid multipart payload.', 'POST /api/persona');
  }
  const parsed = parsePersonaForm(formData, 'create');
  if (!parsed.ok) {
    return errorResponse(400, parsed.error, 'POST /api/persona');
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
    return errorResponse(400, visualError, 'POST /api/persona');
  }

  const voiceError = validateVoiceSource(body.values.voiceId);
  if (voiceError) {
    return errorResponse(400, voiceError, 'POST /api/persona');
  }

  // Optional image library at creation: `images` (files) with parallel
  // `imageTags` / `imageDescriptions` JSON arrays and an optional
  // `imagePrimaryIndex`. Pre-validated here so a bad file fails before any
  // upload or insert happens.
  // Keep every file-like entry (even empty ones): validateImageFile rejects
  // size-0 files with a clear error. Dropping entries here would shift the
  // index-aligned imageTags/imageDescriptions onto the wrong images, so a
  // non-file entry is a hard 400, not a silent filter.
  const allImageEntries = formData.getAll('images');
  if (allImageEntries.some((value) => !isFileLike(value))) {
    return errorResponse(400, 'images must be a list of image files.', 'POST /api/persona');
  }
  const libraryFiles = allImageEntries.filter((value): value is File => isFileLike(value));
  // Parsed once: parseJsonStringArray is pure JSON parsing, no need to
  // re-parse per file inside the map below. Malformed JSON is a 400 here.
  let imageTags: string[];
  let imageDescriptions: string[];
  try {
    imageTags = parseJsonStringArray(formData.get('imageTags'));
    imageDescriptions = parseJsonStringArray(formData.get('imageDescriptions'));
  } catch (error) {
    return errorResponse(400, error instanceof Error ? error.message : 'Invalid imageTags/imageDescriptions.', 'POST /api/persona');
  }
  // Tags/descriptions are matched to files by index: a non-empty array that
  // does not cover every file is a client bug, not a silent default.
  if (
    (imageTags.length > 0 && imageTags.length !== libraryFiles.length) ||
    (imageDescriptions.length > 0 && imageDescriptions.length !== libraryFiles.length)
  ) {
    return errorResponse(400, 'imageTags/imageDescriptions must match the number of images.', 'POST /api/persona');
  }
  const libraryInputs: LibraryImageInput[] = libraryFiles.map((file, index) => ({
    file,
    tag: imageTags[index] ?? '',
    description: imageDescriptions[index] ?? '',
  }));
  // Cheap checks first: parsePrimaryIndex and the range check run before
  // validateLibraryInputs reads every file's bytes, so a malformed index
  // fails fast without the expensive per-file content validation.
  let primaryIndex: number | null;
  try {
    primaryIndex = parsePrimaryIndex(formData.get('imagePrimaryIndex'));
  } catch (error) {
    return errorResponse(
      400,
      error instanceof Error ? error.message : 'Invalid imagePrimaryIndex.',
      'POST /api/persona',
    );
  }
  if (primaryIndex !== null && primaryIndex >= libraryFiles.length) {
    return errorResponse(400, 'imagePrimaryIndex is out of range for the provided images.', 'POST /api/persona');
  }
  const libraryValidation = await validateLibraryInputs(
    body.values.personaMode,
    body.values.faceMixPercent,
    libraryInputs,
  );
  if ('error' in libraryValidation) {
    return errorResponse(400, libraryValidation.error, 'POST /api/persona');
  }
  const validatedLibraryInputs = libraryValidation.inputs;

  const photoPath =
    body.photo && body.photoExtension
      ? await uploadFile(supabase, user.id, body.photo, body.photoExtension)
      : null;
  if (body.photo && !photoPath) {
    return errorResponse(500, 'Failed to upload photo.', 'POST /api/persona');
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
      // Coerced via the shared helper (no nested ternary): no new row may
      // store NULL — see resolveStoredFaceMixPercent.
      face_mix_percent: resolveStoredFaceMixPercent(
        body.values.personaMode,
        body.values.faceMixPercent,
      ),
      face_quality: body.values.faceQuality,
    })
    .select('id')
    .single();

  if (insertError || !persona) {
    return errorResponse(500, 'Failed to create persona.', 'POST /api/persona', {
      cause: insertError,
    });
  }

  let libraryImageIds: string[] = [];
  const warnings: string[] = [];
  if (validatedLibraryInputs.length > 0) {
    const added = await addLibraryImages(supabase, user.id, persona.id, validatedLibraryInputs);
    if ('error' in added) {
      // Roll back the whole creation so a half-written persona never survives.
      // Rollback failures are logged loudly: an invisible failed rollback is
      // worse than a loud one.
      // orphanPaths have no surviving row, so retry their removal BEFORE the
      // persona delete: its cascade erases the image rows, making failed
      // removals unrecoverable.
      // rowBackedPaths still have surviving rows (a cascade erases rows, not
      // storage objects), so their files must NOT be removed before the
      // delete. After a successful delete the rows are gone and the files
      // are true orphans — remove them then, and only then.
      const { orphanPaths, rowBackedPaths } = added.leftoverPaths ?? {
        orphanPaths: [],
        rowBackedPaths: [],
      };
      if (orphanPaths.length > 0) {
        // Retry the orphan removal once via the shared helper (logs loudly
        // on failure); row-backed orchestration below is route-specific.
        await removeOrphanedUploadPaths(supabase, orphanPaths, {
          route: 'api/persona',
        });
      }
      const { error: rollbackError } = await supabase
        .from('personas')
        .delete()
        .eq('id', persona.id);
      if (rollbackError) {
        logger.error('[api/persona] creation rollback failed', rollbackError);
        if (rowBackedPaths.length > 0) {
          // Rows survive, so their storage files must survive too: removing
          // them would leave rows pointing at deleted objects.
          logger.error('[api/persona] creation rollback failed; row-backed image files left in place', undefined, { rowBackedPaths });
        }
      } else if (rowBackedPaths.length > 0) {
        // The cascade erased the image rows: their storage files are now
        // true orphans. One retry, then loud logging — the rows are gone,
        // so this is the last recovery chance.
        const { error: rowBackedRemoveError } = await supabase.storage
          .from(IMAGE_BUCKET)
          .remove(rowBackedPaths);
        if (rowBackedRemoveError) {
          const { error: rowBackedRetryError } = await supabase.storage
            .from(IMAGE_BUCKET)
            .remove(rowBackedPaths);
          if (rowBackedRetryError) {
            logger.error('[api/persona] row-backed library storage remove failed after cascade delete', rowBackedRetryError, { rowBackedPaths });
          }
        }
      }
      if (photoPath) {
        const { error: photoRollbackError } = await supabase.storage
          .from(IMAGE_BUCKET)
          .remove([photoPath]);
        if (photoRollbackError) {
          logger.error('[api/persona] photo rollback failed', photoRollbackError);
        }
      }
      return errorResponse(added.status, added.error, 'POST /api/persona');
    }
    libraryImageIds = added.images.map((image) => image.id);
    // Defensive: addLibraryImages rolls back partial work and returns exactly
    // one row per input, so the up-front range check guarantees this index is
    // in range — there is no partial-success path to skip here.
    // A failed primary swap is surfaced as a warning, not a 500: the persona
    // and its images are already committed.
    if (primaryIndex !== null && primaryIndex < added.images.length) {
      const primaryError = await setPrimaryLibraryImage(
        supabase,
        persona.id,
        added.images[primaryIndex].id,
        user.id,
      );
      if (primaryError) {
        logger.error('[api/persona] set primary library image failed', primaryError.error);
        // Stable code, not English copy: the UI maps it through i18n,
        // consistent with the /api/persona/images warnings contract.
        warnings.push(PERSONA_IMAGE_WARNING_CODES.PRIMARY_SWAP_FAILED);
      }
    }
  }

  // The web UI never sends images[] at creation (the library is edit-only),
  // so warnings only reach direct API-key callers — but the response shape
  // is shared, and the web CreatePersonaResult type describes it.
  trackApiEvent('persona_created', { personaId: persona.id });
  return NextResponse.json({
    success: true,
    personaId: persona.id,
    imageIds: libraryImageIds,
    ...(warnings.length > 0 ? { warnings } : {}),
  });
}

//---------------
// parseJsonStringArray — reads an optional JSON array of strings from a
// multipart field (e.g. imageTags). Returns [] on missing/invalid input.
//---------------
function parseJsonStringArray(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string' || value.trim() === '') return [];
  // Malformed JSON is a client bug, not a silent default: throwing here
  // becomes a 400 at the call site instead of empty tags/descriptions.
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('imageTags/imageDescriptions must be a JSON array of strings.');
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
    throw new Error('imageTags/imageDescriptions must be a JSON array of strings.');
  }
  return parsed;
}

function parsePrimaryIndex(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const trimmed = value.trim();
  // A non-empty but non-numeric value is a client bug, not a silent
  // default: silently dropping it would lose the caller's pinned primary
  // selection. Strict digits only — parseInt('3x') === 3 would coerce.
  if (!/^\d+$/.test(trimmed)) {
    throw new Error('imagePrimaryIndex must be a non-negative integer.');
  }
  return Number.parseInt(trimmed, 10);
}

//---------------
// validateLibraryInputs — library rules at creation:
// - faceless personas (or faceMixPercent 0) accept no images at all;
// - at most MAX_PERSONA_IMAGES files, each a valid image.
//---------------
async function validateLibraryInputs(
  personaMode: 'persona' | 'faceless',
  faceMixPercent: number | null,
  inputs: LibraryImageInput[],
): Promise<{ inputs: LibraryImageInput[] } | { error: string }> {
  if (inputs.length === 0) return { inputs: [] };
  if (personaMode === 'faceless' || faceMixPercent === 0) {
    return { error: 'Faceless persona must not include library images.' };
  }
  if (inputs.length > MAX_PERSONA_IMAGES) {
    return { error: `Image library accepts at most ${MAX_PERSONA_IMAGES} images.` };
  }
  // Intentional per-file validation BEFORE any upload or persona insert, so
  // a bad file never creates partial state the rollback then has to clean
  // up. The magic-byte check reads the real bytes (declared MIME type and
  // extension are client-controlled); the validated bytes are passed through
  // to addLibraryImages so the file is not read a second time.
  // Per-file errors carry the entry index and filename so a caller with
  // up to 10 files can tell which entry to fix. validateImageFile's own
  // messages stay stable (the UI's ERROR_CLASS_PATTERNS matches some of
  // them by shape); the context is appended here at the call site.
  const validated: LibraryImageInput[] = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index] as LibraryImageInput;
    const fileCheck = validateImageFile(input.file);
    if ('error' in fileCheck) {
      return { error: withImageContext(fileCheck.error, index, input.file.name) };
    }
    const content = await readValidatedImage(fileCheck.file);
    if ('error' in content) {
      return { error: withImageContext(content.error, index, input.file.name) };
    }
    validated.push({
      ...input,
      validatedContent: { bytes: content.bytes, mime: content.mime },
    });
  }
  return { inputs: validated };
}

/**
 * Appends the 1-based entry index and filename to a per-file validation
 * error, so batch callers can identify the failing file.
 */
function withImageContext(error: string, index: number, fileName: string): string {
  const name = fileName.trim() === '' ? '' : `: ${fileName}`;
  return `${error} (image ${index + 1}${name})`;
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const user = { id: auth.userId };
  const supabase = auth.isApiKey === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  const personaId = new URL(request.url).searchParams.get('personaId');
  if (!personaId) return errorResponse(400, 'personaId is required.', 'PATCH /api/persona');
  if (!isPersonaAllowed(auth.personaIds, personaId)) {
    return errorResponse(403, 'This API key does not have access to this persona.', 'PATCH /api/persona');
  }

  const parsedPatch = await parsePatchBody(request);
  if (!parsedPatch.ok) return errorResponse(400, parsedPatch.error, 'PATCH /api/persona');
  const patch = parsedPatch.value;

  const { data: persona, error: selectError } = await supabase
    .from('personas')
    .select('id, name, photo_path, avatar_url, voice_id, voice_audio_path')
    .eq('id', personaId)
    .eq('user_id', user.id)
    .single();
  if (selectError || !persona) return errorResponse(404, 'Persona not found.', 'PATCH /api/persona');

  const updates: Record<string, unknown> = {};
  const stalePaths: string[] = [];

  if (patch.name !== null) {
    updates.name = patch.name.trim();
  }

  if (patch.photo && patch.photoExtension) {
    const photoPath = await uploadFile(supabase, user.id, patch.photo, patch.photoExtension);
    if (!photoPath) return errorResponse(500, 'Failed to upload photo.', 'PATCH /api/persona');
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
    return errorResponse(400, 'Nothing to update.', 'PATCH /api/persona');
  }

  const { error: updateError } = await supabase
    .from('personas')
    .update(updates)
    .eq('id', personaId);
  if (updateError) {
    logger.error('[api/persona] update failed', updateError);
    return errorResponse(500, 'Failed to update persona.', 'PATCH /api/persona');
  }

  if (stalePaths.length > 0) {
    const { error: storageError } = await supabase.storage.from(IMAGE_BUCKET).remove(stalePaths);
    if (storageError) {
      logger.error('[api/persona] storage cleanup failed', storageError);
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
  const ROUTE = 'DELETE /api/persona';
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.personaDelete, auth.userId);
  if (limited) return limited;
  const user = { id: auth.userId };
  // Service-role bypasses RLS: every query below is re-scoped by user_id,
  // and the persona row itself is the ownership proof. OAuth callers have
  // no cookie session, so they get the service client like API keys.
  const supabase = auth.isApiKey === true || auth.isOAuth === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  const personaId = new URL(request.url).searchParams.get('personaId');
  if (!personaId) {
    return apiErrorResponse(400, 'personaId is required.', {
      route: ROUTE,
      code: ERROR_CODES.VALIDATION_FAILED,
      field: 'personaId',
    });
  }
  if (!isPersonaAllowed(auth.personaIds, personaId)) {
    return apiErrorResponse(403, 'This API key cannot access this persona.', {
      route: ROUTE,
      code: ERROR_CODES.PERSONA_SCOPE_DENIED,
      field: 'personaId',
    });
  }

  const { data: persona, error: selectError } = await supabase
    .from('personas')
    .select('id, name, photo_path, voice_audio_path')
    .eq('id', personaId)
    .eq('user_id', user.id)
    .single();
  if (selectError || !persona) {
    // PGRST116 = zero rows: missing or belongs to someone else. Any other
    // error is a real DB failure — a bare 404 would hide it.
    if (selectError?.code === 'PGRST116') {
      return apiErrorResponse(404, 'Persona not found.', {
        route: ROUTE,
        code: ERROR_CODES.PERSONA_NOT_FOUND,
      });
    }
    logger.error('[api/persona] persona lookup failed', selectError);
    return apiErrorResponse(500, 'Failed to load persona.', {
      route: ROUTE,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }

  const paths = [persona.photo_path, persona.voice_audio_path].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  // Library images: their rows vanish via on delete cascade, but the storage
  // objects would orphan forever — collect the paths BEFORE the persona row
  // is deleted, while they are still recoverable.
  const { data: libraryRows, error: libraryError } = await supabase
    .from('persona_images')
    .select('image_path')
    .eq('persona_id', personaId)
    .eq('user_id', user.id);
  if (libraryError) {
    logger.error('[api/persona] library image cleanup lookup failed', libraryError);
    return apiErrorResponse(500, 'Failed to remove persona files.', {
      route: ROUTE,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
  for (const row of libraryRows ?? []) {
    if (typeof row.image_path === 'string' && row.image_path.length > 0) {
      paths.push(row.image_path);
    }
  }

  //--------------- Cascade delete: children before parents.
  //
  // Deleting a persona used to leave schedules, slots and generation rows
  // orphaned (a real orphan schedule kept failing the engine's reconcile
  // tick every 60s). Everything tied to the persona goes now, in
  // dependency order: slots -> schedules -> generations -> persona row
  // (persona_images rows vanish via ON DELETE CASCADE).
  //
  // No token refunds, ever: this is a deliberate product decision, stated
  // here and in the UI confirmation dialog. Note the forfeiture is real —
  // the batch flow prepays generation cost up front, so deleting a persona
  // with pending/ready slots destroys prepaid tokens for work that will now
  // never happen.
  //
  // PostgREST has no multi-statement transactions, so a mid-cascade
  // failure cannot roll back. completedSteps names what already went
  // through — the 500 is loud, never a silent half-delete.
  //---------------
  const completedSteps: string[] = [];
  const cascadeFail = (step: string, error: unknown): NextResponse => {
    logger.error(`[api/persona] cascade delete failed at ${step}`, error, {
      personaId,
      completedSteps,
    });
    return apiErrorResponse(500, 'Failed to delete persona.', {
      route: ROUTE,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  };

  // Schedules are posting configs (handful per persona), not per-video
  // rows — intentionally unbounded here; the delete needs every id.
  const { data: scheduleRows, error: schedulesError } = await supabase
    .from('schedules')
    .select('id')
    .eq('persona_id', personaId)
    .eq('user_id', user.id);
  if (schedulesError) return cascadeFail('schedules-select', schedulesError);
  const scheduleIds = (scheduleRows ?? [])
    .map((row) => (typeof row === 'object' && row !== null ? (row as { id: unknown }).id : null))
    .filter((id): id is string => typeof id === 'string');

  let slotsDeleted = 0;
  if (scheduleIds.length > 0) {
    // Slots are deleted from the snapshot select above; a schedule created
    // concurrently (another tab racing the delete) would leave its slots
    // behind. The persona-scoped schedules delete below catches the schedule
    // row itself; the residual slot race is noted, not solved, here.
    const { error: slotsError, count: slotsCount } = await supabase
      .from('scheduled_posts')
      .delete({ count: 'exact' })
      .in('schedule_id', scheduleIds)
      .eq('user_id', user.id);
    if (slotsError) return cascadeFail('scheduled_posts', slotsError);
    slotsDeleted = slotsCount ?? 0;
    completedSteps.push('scheduled_posts');
  }

  const { error: schedulesDeleteError, count: schedulesCount } = await supabase
    .from('schedules')
    .delete({ count: 'exact' })
    .eq('persona_id', personaId)
    .eq('user_id', user.id);
  if (schedulesDeleteError) return cascadeFail('schedules', schedulesDeleteError);
  completedSteps.push('schedules');

  // Engine task ids are collected before the generation rows die, so the
  // engine's task directories can be cleaned up best-effort below. Capped:
  // the cleanup loop has its own budget/skip machinery, and a persona with
  // thousands of generations must not load them all into serverless memory.
  const ENGINE_TASK_ID_CAP = 500;
  const { data: generationRows, error: generationsSelectError, count: generationRowsCount } = await supabase
    .from('video_generations')
    .select('engine_task_id', { count: 'exact' })
    .eq('persona_id', personaId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(ENGINE_TASK_ID_CAP);
  if (generationsSelectError) return cascadeFail('video_generations-select', generationsSelectError);
  if ((generationRowsCount ?? 0) > ENGINE_TASK_ID_CAP) {
    logger.warn('[api/persona] engine task id list truncated by cap', {
      personaId,
      total: generationRowsCount,
      cap: ENGINE_TASK_ID_CAP,
    });
  }
  const engineTaskIds = (generationRows ?? [])
    .map((row) =>
      typeof row === 'object' && row !== null ? (row as { engine_task_id: unknown }).engine_task_id : null,
    )
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const { error: generationsError, count: generationsCount } = await supabase
    .from('video_generations')
    .delete({ count: 'exact' })
    .eq('persona_id', personaId)
    .eq('user_id', user.id);
  if (generationsError) return cascadeFail('video_generations', generationsError);
  completedSteps.push('video_generations');

  // Row first, storage second: if the row delete fails, nothing is lost; if
  // the storage remove fails afterwards, the persona is already gone and the
  // orphaned files are cleanable — never destroy data still referenced by a
  // surviving row.
  const { error: deleteError } = await supabase
    .from('personas')
    .delete()
    .eq('id', personaId)
    .eq('user_id', user.id);
  if (deleteError) {
    return cascadeFail('personas', deleteError);
  }
  completedSteps.push('personas');

  // Row first, storage second: if the row delete fails, nothing is lost; if
  // the storage remove fails afterwards, the persona is already gone and the
  // orphaned files are cleanable — never destroy data still referenced by a
  // surviving row. Cleanup runs after() the response: the DB delete is
  // committed, and a hung Supabase storage call must not turn a successful
  // delete into a client-side timeout.
  const imagePaths = paths.length > 0 ? [...paths] : null;
  const engineTaskIdsForCleanup = engineTaskIds.length > 0 ? [...engineTaskIds] : null;

  // Engine task directories would orphan on the engine host now that their
  // generation rows are gone. This runs after() the response is sent: the
  // DB delete is already committed, and a slow or down engine must not
  // turn a successful delete into a client-side timeout (the UI would
  // report failure for a delete that happened). Sequential on purpose —
  // one small DELETE in flight at a time — with a per-call timeout and an
  // aggregate budget: after() has no deadline of its own, so an unbounded
  // loop would orphan the tail silently when the function is cut off.
  // Skipped ids are logged loudly, never dropped quietly.
  const engineBaseUrl = process.env.MONEYPRINT_API_URL;
  if (!engineBaseUrl && engineTaskIds.length > 0) {
    logger.warn('[api/persona] MONEYPRINT_API_URL is not set; engine task dirs will orphan');
  }
  after(() => {
    void (async () => {
      // Storage cleanup first (persona images), then engine task dirs —
      // both best-effort, both after the committed delete.
      if (imagePaths) {
        const { error: storageError } = await supabase.storage.from(IMAGE_BUCKET).remove(imagePaths);
        if (storageError) {
          logger.error('[api/persona] storage cleanup failed after delete', storageError, {
            paths: imagePaths,
          });
        }
      }
      if (!engineBaseUrl || !engineTaskIdsForCleanup) return;
      const taskIds = engineTaskIdsForCleanup;
      const userId = user.id;
      const start = Date.now();
      const skipped: string[] = [];
      for (const taskId of taskIds) {
        if (Date.now() - start >= ENGINE_CLEANUP_BUDGET_MS) {
          skipped.push(taskId);
          continue;
        }
        if (!SAFE_TASK_ID.test(taskId)) {
          logger.warn('[api/persona] skipping unsafe engine task id', { taskId });
          continue;
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const res = await fetch(
            `${engineBaseUrl.replace(/\/+$/, '')}/api/v1/tasks/${encodeURIComponent(taskId)}`,
            {
              method: 'DELETE',
              headers: engineAuthHeaders(userId),
              signal: controller.signal,
            },
          );
          if (!res.ok) {
            logger.warn('[api/persona] engine task cleanup failed', { taskId, status: res.status });
          }
        } catch (error) {
          logger.warn('[api/persona] engine task cleanup failed', { taskId, error });
        } finally {
          clearTimeout(timeout);
        }
      }
      if (skipped.length > 0) {
        logger.warn('[api/persona] engine task cleanup budget spent, ids skipped', {
          skipped,
        });
      }
    })();
  });

  trackApiEvent('persona_deleted', {
    userId: user.id,
    personaId,
    schedulesDeleted: schedulesCount ?? scheduleIds.length,
    slotsDeleted,
    videosDeleted: generationsCount ?? engineTaskIds.length,
  });

  return NextResponse.json({
    success: true,
  });
}

function asFile(value: FormDataEntryValue | null): File | null {
  return isFileLike(value) ? value : null;
}

function optionalString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return value;
}

//---------------
// uploadFile — uploads the file to the 'personas' bucket under the user's folder.
// Exported for reuse by other persona routes.
//---------------
export async function uploadFile(
  supabase: SupabaseClient,
  userId: string,
  file: File,
  extension: string,
): Promise<string | null> {
  const path = `${userId}/${randomUUID()}.${extension}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, bytes, {
    contentType: file.type,
  });

  if (error) {
    logger.error('[api/persona] storage upload failed', error, { path });
    return null;
  }
  return path;
}
