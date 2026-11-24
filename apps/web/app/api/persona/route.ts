import type { Database } from '@/lib/supabase/database.gen';
import { randomUUID } from 'crypto';
import { NextResponse, after } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';
import { isPersonaAllowed, isScopedApiKey } from '@/lib/api-keys';
import {
  parsePersonaForm,
  validateVisualCues,
} from '@/lib/persona-schema';
import { applyPersonaVoicePatch, personaVoiceRejectionOptions, validatePersonaVoiceInput } from '@/lib/persona-voice-validate';
import {
  addLibraryImages,
  IMAGE_BUCKET,
  isFileLike,
  setPrimaryLibraryImage,
  PERSONA_IMAGE_WARNING_CODES,
  type LibraryImageInput,
} from '@/lib/persona-images';
import { validateLibraryInputs } from '@/lib/persona-library-validate';
import { resolvePersonaAvatar, rollbackStoragePath } from '@/lib/persona-remote-face';
import { logger } from '@/lib/logger';
import { englishOnlyPatchError, parsePatchBody } from './patch-body';
import { parsePersonaIdQuery } from '@/lib/contracts/personas';
import { collectPersonaStoragePaths } from './delete-storage-paths';
import { applyPersonaPatchFields } from './patch-updates';
import { parseJsonStringArray, parsePrimaryIndex } from './form-parsing';
import { errorResponse } from './error-response';
import { personaValidationError } from './validation-error';
import { savePersonaBinding } from './create-binding';
import { rollbackLibraryCreation } from './create-library-rollback';
import { uploadFile } from './upload-photo';
import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES } from '@/lib/error-codes';
import { isEnglishLanguage, ONLY_ENGLISH_VIDEOS_MESSAGE } from '@/lib/language-gate';
import { trackApiEvent } from '@/lib/analytics';
import { SAFE_TASK_ID } from '@/lib/video-urls';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { buildPersonaInsertRow } from './create-row';

const ENGINE_CLEANUP_BUDGET_MS = 20_000;

async function postHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.personaWrite, auth.userId);
  if (limited) return limited;
  if (isScopedApiKey(auth)) {
    return errorResponse(403, 'This API key is restricted to specific personas and cannot create new ones.', 'POST /api/persona');
  }
  const user = { id: auth.userId };
  const supabase = auth.isApiKey === true || auth.isOAuth === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return personaValidationError('Invalid multipart payload.', 'POST /api/persona');
  }
  const parsed = parsePersonaForm(formData, 'create');
  if (!parsed.ok) {
    return personaValidationError(parsed.error, 'POST /api/persona');
  }
  const body = parsed.value;

  if (
    body.values.language !== null &&
    body.values.language !== undefined &&
    body.values.language.trim().length > 0 &&
    !isEnglishLanguage(body.values.language)
  ) {
    return personaValidationError(ONLY_ENGLISH_VIDEOS_MESSAGE, 'POST /api/persona', { field: 'language' });
  }

  const hasPhoto = body.photo !== null;
  const hasAvatarUrl = body.values.avatarUrl !== null;
  const visualError = validateVisualCues(hasPhoto, hasAvatarUrl);
  if (visualError) {
    return personaValidationError(visualError, 'POST /api/persona');
  }

  const voiceError = await validatePersonaVoiceInput(supabase, user.id, body.values.voiceId);
  if (voiceError) {
    return personaValidationError(voiceError, 'POST /api/persona', personaVoiceRejectionOptions(body.values.voiceId));
  }

  const allImageEntries = formData.getAll('images');
  if (allImageEntries.some((value) => !isFileLike(value))) {
    return personaValidationError('images must be a list of image files.', 'POST /api/persona', { field: 'images' });
  }
  const libraryFiles = allImageEntries.filter((value): value is File => isFileLike(value));
  let imageTags: string[];
  let imageDescriptions: string[];
  try {
    imageTags = parseJsonStringArray(formData.get('imageTags'));
    imageDescriptions = parseJsonStringArray(formData.get('imageDescriptions'));
  } catch (error) {
    return personaValidationError(error instanceof Error ? error.message : 'Invalid imageTags/imageDescriptions.', 'POST /api/persona', { field: 'imageTags' });
  }
  if (
    (imageTags.length > 0 && imageTags.length !== libraryFiles.length) ||
    (imageDescriptions.length > 0 && imageDescriptions.length !== libraryFiles.length)
  ) {
    return personaValidationError('imageTags/imageDescriptions must match the number of images.', 'POST /api/persona', { field: 'imageTags' });
  }
  const libraryInputs: LibraryImageInput[] = libraryFiles.map((file, index) => ({
    file,
    tag: imageTags[index] ?? '',
    description: imageDescriptions[index] ?? '',
  }));
  let primaryIndex: number | null;
  try {
    primaryIndex = parsePrimaryIndex(formData.get('imagePrimaryIndex'));
  } catch (error) {
    return personaValidationError(
      error instanceof Error ? error.message : 'Invalid imagePrimaryIndex.',
      'POST /api/persona',
      { field: 'imagePrimaryIndex' },
    );
  }
  if (primaryIndex !== null && primaryIndex >= libraryFiles.length) {
    return personaValidationError('imagePrimaryIndex is out of range for the provided images.', 'POST /api/persona', { field: 'imagePrimaryIndex' });
  }
  const libraryValidation = await validateLibraryInputs(libraryInputs);
  if ('error' in libraryValidation) {
    return personaValidationError(libraryValidation.error, 'POST /api/persona', { field: 'images', logMessage: libraryValidation.logMessage });
  }
  const validatedLibraryInputs = libraryValidation.inputs;

  const personaId = randomUUID();
  const photoPath =
    body.photo && body.photoExtension
      ? await uploadFile(supabase, user.id, personaId, body.photo, body.photoExtension)
      : null;
  if (body.photo && !photoPath) {
    return errorResponse(500, 'Failed to upload photo.', 'POST /api/persona');
  }

  let avatarUrl = body.values.avatarUrl;
  let photoPathToRollback = photoPath;
  if (photoPathToRollback === null && typeof avatarUrl === 'string') {
    const resolved = await resolvePersonaAvatar(supabase, user.id, personaId, avatarUrl);
    if (!resolved.ok) {
      return personaValidationError(resolved.error, 'POST /api/persona', { field: 'avatarUrl' });
    }
    photoPathToRollback = resolved.photoPath;
    avatarUrl = resolved.avatarUrl;
  }

  const { data: persona, error: insertError } = await createSupabaseServiceClient()
    .from('personas')
    .insert(buildPersonaInsertRow({
      personaId,
      userId: user.id,
      photoPath: photoPathToRollback,
      avatarUrl,
      values: body.values,
    }))
    .select('id')
    .single();

  if (insertError || !persona) {
    await rollbackStoragePath(supabase, photoPathToRollback);
    return errorResponse(500, 'Failed to create persona.', 'POST /api/persona', {
      cause: insertError ? { code: insertError.code } : undefined,
    });
  }

  const binding = await savePersonaBinding(
    supabase,
    user.id,
    persona.id,
    body.values.publishingAccounts,
    photoPathToRollback,
  );
  if (!binding.ok) {
    return errorResponse(binding.status, binding.error, 'POST /api/persona', { code: binding.code });
  }

  let libraryImageIds: string[] = [];
  const warnings: string[] = [];
  if (validatedLibraryInputs.length > 0) {
    const added = await addLibraryImages(supabase, user.id, personaId, validatedLibraryInputs);
    if ('error' in added) {
      return rollbackLibraryCreation(supabase, user.id, persona.id, photoPathToRollback, added);
    }
    libraryImageIds = added.images.map((image) => image.id);
    if (primaryIndex !== null && primaryIndex < added.images.length) {
      const primaryError = await setPrimaryLibraryImage(
        supabase,
        persona.id,
        added.images[primaryIndex].id,
        user.id,
      );
      if (primaryError) {
        logger.error('[api/persona] set primary library image failed', primaryError.error);
        warnings.push(PERSONA_IMAGE_WARNING_CODES.PRIMARY_SWAP_FAILED);
      }
    }
  }

  trackApiEvent('persona_created', { personaId: persona.id });
  return NextResponse.json({
    success: true,
    personaId: persona.id,
    imageIds: libraryImageIds,
    ...(warnings.length > 0 ? { warnings } : {}),
  });
}

async function patchHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.personaWrite, auth.userId);
  if (limited) return limited;
  const user = { id: auth.userId };
  const supabase = auth.isApiKey === true || auth.isOAuth === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  const parsedPersonaId = parsePersonaIdQuery(request.url);
  if (!parsedPersonaId.ok) return personaValidationError(parsedPersonaId.error, 'PATCH /api/persona', { field: 'personaId' });
  const personaId = parsedPersonaId.query.personaId;
  if (!isPersonaAllowed(auth.personaIds, personaId)) {
    return errorResponse(403, 'This API key does not have access to this persona.', 'PATCH /api/persona');
  }

  const parsedPatch = await parsePatchBody(request);
  if (!parsedPatch.ok) return personaValidationError(parsedPatch.error, 'PATCH /api/persona', { logMessage: parsedPatch.logMessage });
  const patch = parsedPatch.value;

  const languageError = englishOnlyPatchError(patch);
  if (languageError) return personaValidationError(languageError, 'PATCH /api/persona', { field: 'language' });

  const { data: persona, error: selectError } = await supabase
    .from('personas')
    .select('id, name, photo_path, avatar_url, voice_id, voice_audio_path, cta_type, cta_url, cta_instruction')
    .eq('id', personaId)
    .eq('user_id', user.id)
    .single();
  if (selectError || !persona) return errorResponse(404, 'Persona not found.', 'PATCH /api/persona');

  const updates: Database['public']['Tables']['personas']['Update'] = {};
  const stalePaths: string[] = [];
  let replacementPhotoPath: string | null = null;

  if (patch.name !== null) {
    updates.name = patch.name.trim();
  }

  const voicePatchError = await applyPersonaVoicePatch(
    supabase, user.id, persona, patch.voiceId, updates, stalePaths,
  );
  if (voicePatchError) {
    return personaValidationError(voicePatchError, 'PATCH /api/persona', personaVoiceRejectionOptions(patch.voiceId));
  }

  const ctaError = applyPersonaPatchFields(patch, updates, persona);
  if (ctaError) return personaValidationError(ctaError, 'PATCH /api/persona', { field: 'ctaType' });

  if (patch.photo && patch.photoExtension) {
    const photoPath = await uploadFile(supabase, user.id, personaId, patch.photo, patch.photoExtension);
    if (!photoPath) return errorResponse(500, 'Failed to upload photo.', 'PATCH /api/persona');
    updates.photo_path = photoPath;
    updates.avatar_url = null;
    replacementPhotoPath = photoPath;
    if (typeof persona.photo_path === 'string' && persona.photo_path && persona.photo_path !== photoPath) {
      stalePaths.push(persona.photo_path);
    }
  } else if (patch.avatarUrl !== null) {
    const resolved = await resolvePersonaAvatar(supabase, user.id, personaId, patch.avatarUrl, {
      existingPhotoPath: typeof persona.photo_path === 'string' ? persona.photo_path : null,
    });
    if (!resolved.ok) {
      return personaValidationError(resolved.error, 'PATCH /api/persona', { field: 'avatarUrl' });
    }
    updates.avatar_url = resolved.avatarUrl;
    updates.photo_path = resolved.photoPath;
    replacementPhotoPath = resolved.photoPath;
    if (
      typeof persona.photo_path === 'string' &&
      persona.photo_path &&
      persona.photo_path !== resolved.photoPath
    ) {
      stalePaths.push(persona.photo_path);
    }
  }

  if (Object.keys(updates).length === 0) {
    return personaValidationError('Nothing to update.', 'PATCH /api/persona');
  }

  const { error: updateError } = await createSupabaseServiceClient()
    .from('personas')
    .update(updates)
    .eq('id', personaId)
    .eq('user_id', user.id);
  if (updateError) {
    logger.error('[api/persona] update failed', { personaId, code: updateError.code });
    if (replacementPhotoPath && replacementPhotoPath !== persona.photo_path) {
      await rollbackStoragePath(supabase, replacementPhotoPath);
    }
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

async function deleteHandler(request: Request): Promise<NextResponse> {
  const ROUTE = 'DELETE /api/persona';
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.personaDelete, auth.userId);
  if (limited) return limited;
  const user = { id: auth.userId };
  const supabase = auth.isApiKey === true || auth.isOAuth === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  const parsedPersonaId = parsePersonaIdQuery(request.url);
  if (!parsedPersonaId.ok) {
    return apiErrorResponse(400, parsedPersonaId.error, {
      route: ROUTE,
      code: ERROR_CODES.VALIDATION_FAILED,
      field: 'personaId',
    });
  }
  const personaId = parsedPersonaId.query.personaId;
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

  const { paths, error: libraryError } = await collectPersonaStoragePaths(supabase, persona, personaId, user.id);
  if (libraryError) {
    logger.error('[api/persona] library image cleanup lookup failed', libraryError);
    return apiErrorResponse(500, 'Failed to remove persona files.', {
      route: ROUTE,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }

  const service = createSupabaseServiceClient();
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
    const { error: slotsError, count: slotsCount } = await service
      .from('scheduled_posts')
      .delete({ count: 'exact' })
      .in('schedule_id', scheduleIds)
      .eq('user_id', user.id);
    if (slotsError) return cascadeFail('scheduled_posts', slotsError);
    slotsDeleted = slotsCount ?? 0;
    completedSteps.push('scheduled_posts');
  }

  const { error: schedulesDeleteError, count: schedulesCount } = await service
    .from('schedules')
    .delete({ count: 'exact' })
    .eq('persona_id', personaId)
    .eq('user_id', user.id);
  if (schedulesDeleteError) return cascadeFail('schedules', schedulesDeleteError);
  completedSteps.push('schedules');

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
  const { error: generationsError, count: generationsCount } = await service
    .from('video_generations')
    .delete({ count: 'exact' })
    .eq('persona_id', personaId)
    .eq('user_id', user.id);
  if (generationsError) return cascadeFail('video_generations', generationsError);
  completedSteps.push('video_generations');

  const { error: deleteError } = await service
    .from('personas')
    .delete()
    .eq('id', personaId)
    .eq('user_id', user.id);
  if (deleteError) {
    return cascadeFail('personas', deleteError);
  }
  completedSteps.push('personas');

  const imagePaths = paths.length > 0 ? [...paths] : null;
  const engineTaskIdsForCleanup = engineTaskIds.length > 0 ? [...engineTaskIds] : null;

  const engineBaseUrl = process.env.MONEYPRINT_API_URL;
  if (!engineBaseUrl && engineTaskIds.length > 0) {
    logger.warn('[api/persona] MONEYPRINT_API_URL is not set; engine task dirs will orphan');
  }
  after(() => {
    void (async () => {
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
      let authHeaders: Record<string, string>;
      try {
        authHeaders = engineAuthHeaders(userId);
      } catch (error) {
        logger.error('[api/persona] engine auth misconfigured; task dirs will orphan', { error });
        return;
      }
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
              headers: authHeaders,
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


export const POST = withApiErrorReporting('POST /api/persona', postHandler, { getUserId: resolveReportingUserId });
export const DELETE = withApiErrorReporting('DELETE /api/persona', deleteHandler, { getUserId: resolveReportingUserId });
export const PATCH = withApiErrorReporting('PATCH /api/persona', patchHandler, { getUserId: resolveReportingUserId });
