import type { Database } from '@/lib/supabase/database.gen';
import { randomUUID } from 'crypto';
import { NextResponse, after } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { isPersonaAllowed, isScopedApiKey } from '@/lib/api-keys';
import { parsePersonaForm } from '@/lib/persona-schema';
import { PERSONA_PHOTO_BUCKET, rollbackStoragePath } from '@/lib/persona-photo';
import { logger } from '@/lib/logger';
import { parsePatchBody } from './patch-body';
import { parsePersonaIdQuery } from '@/lib/contracts/personas';
import { collectPersonaStoragePaths } from './delete-storage-paths';
import { errorResponse } from './error-response';
import { personaValidationError } from './validation-error';
import { savePersonaBinding } from './create-binding';
import { uploadFile } from './upload-photo';
import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES } from '@/lib/error-codes';
import { trackApiEvent } from '@/lib/analytics';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { buildPersonaInsertRow } from './create-row';
import { applyPersonaPatchFields } from './patch-updates';

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
  const parsed = parsePersonaForm(formData);
  if (!parsed.ok) {
    return personaValidationError(parsed.error, 'POST /api/persona');
  }
  const body = parsed.value;

  const personaId = randomUUID();
  const photoPath =
    body.photo && body.photoExtension
      ? await uploadFile(supabase, user.id, personaId, body.photo, body.photoExtension)
      : null;
  if (body.photo && !photoPath) {
    return errorResponse(500, 'Failed to upload photo.', 'POST /api/persona');
  }

  const { data: persona, error: insertError } = await createSupabaseServiceClient()
    .from('personas')
    .insert(buildPersonaInsertRow({
      personaId,
      userId: user.id,
      photoPath,
      values: body.values,
    }))
    .select('id')
    .single();

  if (insertError || !persona) {
    await rollbackStoragePath(supabase, photoPath);
    return errorResponse(500, 'Failed to create persona.', 'POST /api/persona', {
      cause: insertError ? { code: insertError.code } : undefined,
    });
  }

  const binding = await savePersonaBinding(
    supabase,
    user.id,
    persona.id,
    body.values.publishingAccounts,
    photoPath,
  );
  if (!binding.ok) {
    return errorResponse(binding.status, binding.error, 'POST /api/persona', { code: binding.code });
  }

  trackApiEvent('persona_created', { personaId: persona.id });
  return NextResponse.json({ success: true, personaId: persona.id });
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

  const { data: persona, error: selectError } = await supabase
    .from('personas')
    .select('id, name, photo_path')
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
  const patchError = applyPersonaPatchFields(patch, updates, {});
  if (patchError !== null) return personaValidationError(patchError, 'PATCH /api/persona');

  if (patch.photo && patch.photoExtension) {
    const photoPath = await uploadFile(supabase, user.id, personaId, patch.photo, patch.photoExtension);
    if (!photoPath) return errorResponse(500, 'Failed to upload photo.', 'PATCH /api/persona');
    updates.photo_path = photoPath;
    updates.avatar_url = null;
    replacementPhotoPath = photoPath;
    if (typeof persona.photo_path === 'string' && persona.photo_path && persona.photo_path !== photoPath) {
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
    const { error: storageError } = await supabase.storage.from(PERSONA_PHOTO_BUCKET).remove(stalePaths);
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
    .select('id, name, photo_path')
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

  const paths = collectPersonaStoragePaths(persona);

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

  const { error: deleteError } = await service
    .from('personas')
    .delete()
    .eq('id', personaId)
    .eq('user_id', user.id);
  if (deleteError) {
    return cascadeFail('personas', deleteError);
  }
  completedSteps.push('personas');

  if (paths.length > 0) {
    after(() => {
      void (async () => {
        const { error: storageError } = await supabase.storage.from(PERSONA_PHOTO_BUCKET).remove(paths);
        if (storageError) {
          logger.error('[api/persona] storage cleanup failed after delete', storageError, { paths });
        }
      })();
    });
  }

  trackApiEvent('persona_deleted', {
    userId: user.id,
    personaId,
    schedulesDeleted: schedulesCount ?? scheduleIds.length,
    slotsDeleted,
  });

  return NextResponse.json({
    success: true,
  });
}


export const POST = withApiErrorReporting('POST /api/persona', postHandler, { getUserId: resolveReportingUserId });
export const DELETE = withApiErrorReporting('DELETE /api/persona', deleteHandler, { getUserId: resolveReportingUserId });
export const PATCH = withApiErrorReporting('PATCH /api/persona', patchHandler, { getUserId: resolveReportingUserId });
