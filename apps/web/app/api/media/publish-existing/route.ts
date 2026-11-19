import { NextResponse } from 'next/server';

import { apiErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { isPersonaAllowed } from '@/lib/api-keys';
import { trackApiEvent } from '@/lib/analytics';
import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { PUBLISH_EXISTING_NAMESPACE, resolveIdempotency } from '@/lib/idempotency';
import { logger } from '@/lib/logger';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  VideoUploadError,
  assertUploadFitsProviders,
  createSupabaseVideoUploadStore,
  type VideoUploadRow,
} from '@/lib/videos/signed-upload';
import {
  UPLOAD_SLOT_REFERENCE_INDEX,
  assertUploadNotScheduled,
  uploadAlreadyScheduledError,
} from '@/lib/videos/upload-slot-reference';
import { scheduleAccountColumns } from '../../videos/generate-and-schedule/account-columns';
import {
  SCHEDULE_PK_CONSTRAINT,
  violatedConstraint,
} from '../../videos/generate-and-schedule/constraint-violations';
import { rejectInvalidRequest } from '../../videos/generate-and-schedule/request-validation';
import { buildSlotRows } from '../../videos/generate-and-schedule/slot-rows';
import { resolvePublishAccounts } from './resolve-accounts';
import { invalid } from '../../videos/generate-and-schedule/validation-issues';
import {
  asapReplayResponse,
  asapScopeKey,
  claimAsapLedger,
  hasGrantedAccounts,
  publishExistingMediaAsap,
  releaseAsapLedger,
  type AsapLedger,
} from './asap';
import type { PublishExistingContext } from './context';
import {
  checkPublishExistingSemantics,
  decodeImageMedia,
  parsePublishExistingBody,
  type ImageContentType,
  type ScheduledMediaKind,
} from './schema';
import {
  ExistingMediaError,
  fetchScopedEngineTask,
  loadReadyVideoUpload,
  storeScheduledImage,
  type EngineTaskRecord,
} from './media-resolve';
import { replaySchedule, toSlotSummaries } from './replay';
import { resolvePublishAtSlot } from './schedule-slot';

const ROUTE = 'POST /api/media/publish-existing';

async function scheduleExistingMedia(ctx: PublishExistingContext): Promise<NextResponse> {
  const { supabase, userId, input, accountIds, reconnectWarning } = ctx;
  const schedule = input.publishing.schedule;
  if (schedule === undefined) {
    return apiErrorResponse(400, 'publishing.schedule is required when publishing.mode is \'scheduled\'.', {
      route: ROUTE,
      code: ERROR_CODES.VALIDATION_FAILED,
      field: 'publishing.schedule',
    });
  }
  const slot = resolvePublishAtSlot(schedule.publishAt, schedule.timezone, ROUTE);
  if (slot instanceof NextResponse) return slot;
  const { slots } = slot;
  const slotAt = slots[0].slotAtISO;
  const idem = resolveIdempotency(userId, input.idempotencyKey, ctx.request, PUBLISH_EXISTING_NAMESPACE);
  const scheduleId = idem.scheduleId;

  let taskId: string | null = null;
  let mediaKindValue: ScheduledMediaKind | null = null;
  let mediaRef: string | null = null;
  let mediaContentType: string | null = null;
  let storedImagePath: string | null = null;
  const uploadStore = createSupabaseVideoUploadStore();
  try {
    if (ctx.taskRecord !== null) {
      taskId = ctx.input.media.kind === 'task' ? ctx.input.media.taskId : null;
    } else if (ctx.uploadRow !== null) {
      mediaKindValue = 'upload';
      mediaRef = ctx.uploadRow.id;
      mediaContentType = ctx.uploadRow.declared_content_type ?? ctx.uploadRow.detected_content_type ?? 'video/mp4';
      const extended = await uploadStore.updateUpload(ctx.uploadRow.id, 'ready', {
        expires_at: new Date(Date.parse(slotAt) + 24 * 60 * 60 * 1000).toISOString(),
      });
      if (!extended) {
        return apiErrorResponse(409, formatErrorMessage(ERROR_CODES.VIDEO_UPLOAD_CONSUMED), {
          route: ROUTE,
          code: ERROR_CODES.VIDEO_UPLOAD_CONSUMED,
          field: 'media.uploadId',
        });
      }
    } else if (ctx.image !== null) {
      mediaKindValue = 'image';
      mediaContentType = ctx.image.contentType;
      storedImagePath = await storeScheduledImage(supabase, userId, ctx.image.buffer, ctx.image.contentType);
      mediaRef = storedImagePath;
    }
  } catch (error) {
    if (error instanceof ExistingMediaError) {
      return apiErrorResponse(error.status, error.message, { route: ROUTE, code: error.code });
    }
    throw error;
  }

  const { error: scheduleError } = await supabase.from('schedules').insert({
    id: scheduleId,
    user_id: userId,
    persona_id: input.personaId,
    providers: input.publishing.providers,
    ...scheduleAccountColumns(accountIds),
    pinterest_board_id: input.publishing.pinterestBoardId,
    days_of_week: null,
    start_hour: null,
    end_hour: null,
    posts_per_day: 1,
    times: [slot.time],
    timezone: schedule.timezone,
    scheduled_at: null,
    active: true,
    publish_mode: 'scheduled',
    post_voice_id: null,
    post_voice_audio_url: null,
    post_cta_text: null,
    post_niche: null,
    post_language: null,
    post_video_aspect: null,
    post_video_layout: null,
    post_paragraph_number: null,
    post_face_quality: null,
  });
  if (scheduleError) {
    if (storedImagePath !== null) {
      await supabase.storage
        .from('uploads')
        .remove([storedImagePath])
        .catch((error: unknown) => logger.error('[publish-existing] stored image cleanup failed', error, { scheduleId, userId }));
    }
    if (violatedConstraint(scheduleError) === SCHEDULE_PK_CONSTRAINT) {
      const replay = await replaySchedule(supabase, scheduleId, userId, ROUTE, reconnectWarning);
      if (replay !== null) return replay;
    }
    logger.error('[publish-existing] schedule insert failed', scheduleError, { scheduleId, userId });
    return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
      route: ROUTE,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }

  const rows = buildSlotRows({
    slots,
    title: input.title,
    description: input.description,
    scheduleId,
    userId,
    videoType: 'faceless',
    chargedTokens: 0,
    segments: undefined,
  }).map((row) => ({
    ...row,
    status: 'ready',
    task_id: taskId,
    media_kind: mediaKindValue,
    media_ref: mediaRef,
    media_content_type: mediaContentType,
  }));
  const { data: inserted, error: slotsError } = await supabase
    .from('scheduled_posts')
    .insert(rows)
    .select('id, slot_at, title');
  if (slotsError || inserted === null) {
    const uploadTaken = violatedConstraint(slotsError) === UPLOAD_SLOT_REFERENCE_INDEX;
    if (!uploadTaken) logger.error('[publish-existing] slot insert failed', slotsError, { scheduleId, userId });
    await supabase.from('schedules').delete().eq('id', scheduleId).eq('user_id', userId);
    if (storedImagePath !== null) {
      await supabase.storage
        .from('uploads')
        .remove([storedImagePath])
        .catch((error: unknown) => logger.error('[publish-existing] stored image cleanup failed', error, { scheduleId, userId }));
    }
    if (uploadTaken) {
      const taken = uploadAlreadyScheduledError();
      return apiErrorResponse(taken.status, taken.message, { route: ROUTE, code: taken.code, field: 'media.uploadId' });
    }
    return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
      route: ROUTE,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
  trackApiEvent('publish_existing_scheduled', {
    userId,
    scheduleId,
    mediaKind: input.media.kind,
    providers: input.publishing.providers,
  });
  return NextResponse.json({
    success: true,
    mode: 'scheduled',
    replayed: false,
    schedule: { id: scheduleId },
    slots: toSlotSummaries(inserted),
    ...(reconnectWarning === null ? {} : { warnings: [reconnectWarning] }),
  });
}

async function postHandler(request: Request): Promise<NextResponse> {
  const logId = logger.generateLogId();
  const startTime = Date.now();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rejectInvalidRequest([invalid('Invalid JSON payload.')]);
  }
  const parsed = parsePublishExistingBody(body);
  if (!parsed.ok) return rejectInvalidRequest(parsed.issues);
  const checked = checkPublishExistingSemantics(parsed.value);
  if (!checked.ok) return rejectInvalidRequest(checked.issues);
  const input = checked.value;

  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const userId = auth.userId;

  const limited = await applyRateLimit(request, RATE_LIMITS.publishExisting, userId);
  if (limited) return limited;

  const supabase = createSupabaseServiceClient();
  const { personaId } = input;
  if (personaId !== null && !isPersonaAllowed(auth.personaIds, personaId)) {
    return apiErrorResponse(403, formatErrorMessage(ERROR_CODES.PERSONA_SCOPE_DENIED), {
      route: ROUTE,
      code: ERROR_CODES.PERSONA_SCOPE_DENIED,
      field: 'personaId',
    });
  }

  const resolved = await resolvePublishAccounts(
    supabase,
    userId,
    personaId,
    input.publishing.providers,
    input.publishing.accounts,
    ROUTE,
  );
  const reconnectWarning = resolved instanceof NextResponse ? null : resolved.reconnectWarning;
  const idem = resolveIdempotency(userId, input.idempotencyKey, request, PUBLISH_EXISTING_NAMESPACE);
  if (input.publishing.mode === 'scheduled') {
    const replay = await replaySchedule(supabase, idem.scheduleId, userId, ROUTE, reconnectWarning);
    if (replay !== null) return replay;
  }
  if (resolved instanceof NextResponse) return resolved;
  const { accountIds } = resolved;

  let ledger: AsapLedger | null = null;
  if (input.publishing.mode === 'asap' && idem.clientSupplied) {
    try {
      ledger = await claimAsapLedger(asapScopeKey(idem.scheduleId), userId, input.publishing.providers, accountIds);
    } catch (error) {
      logger.error('[publish-existing] publish ledger claim failed', error, { userId, logId });
      return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
        route: ROUTE,
        code: ERROR_CODES.INTERNAL_ERROR,
      });
    }
    if (!hasGrantedAccounts(ledger)) return asapReplayResponse(input, userId, logId, ledger);
  }

  const verified = await verifyMedia(supabase, auth, input);
  if (verified instanceof NextResponse) {
    if (ledger !== null) await releaseAsapLedger(ledger, 'media verification failed');
    return verified;
  }

  const ctx: PublishExistingContext = { route: ROUTE, supabase, userId, request, input, accountIds, reconnectWarning, ...verified, logId, startTime };
  if (input.publishing.mode === 'scheduled') {
    return scheduleExistingMedia(ctx);
  }
  return publishExistingMediaAsap(ctx, ledger);
}

interface VerifiedMedia {
  taskRecord: EngineTaskRecord | null;
  uploadRow: VideoUploadRow | null;
  image: { buffer: Buffer; contentType: ImageContentType } | null;
}

async function verifyMedia(
  supabase: PublishExistingContext['supabase'],
  auth: Parameters<typeof fetchScopedEngineTask>[1],
  input: PublishExistingContext['input'],
): Promise<VerifiedMedia | NextResponse> {
  const { userId } = auth;
  let taskRecord: EngineTaskRecord | null = null;
  let uploadRow: VideoUploadRow | null = null;
  let image: { buffer: Buffer; contentType: ImageContentType } | null = null;
  try {
    if (input.media.kind === 'task') {
      taskRecord = await fetchScopedEngineTask(supabase, auth, input.media.taskId);
      if (taskRecord === null) {
        return apiErrorResponse(404, 'Video not found.', { route: ROUTE, code: 'MEDIA_NOT_FOUND', field: 'media.taskId' });
      }
      if (taskRecord.state !== 1 || (taskRecord.videos.length === 0 && !taskRecord.hasArchive)) {
        return apiErrorResponse(400, 'Video has not finished generating yet.', {
          route: ROUTE,
          code: 'MEDIA_NOT_READY',
          field: 'media.taskId',
        });
      }
    } else if (input.media.kind === 'upload') {
      uploadRow = await loadReadyVideoUpload(createSupabaseVideoUploadStore(), userId, input.media.uploadId, new Date());
      assertUploadFitsProviders(uploadRow, input.publishing.providers);
      await assertUploadNotScheduled(supabase, userId, input.media.uploadId);
    } else {
      const decoded = decodeImageMedia(input.media);
      if (!decoded.ok) return rejectInvalidRequest(decoded.issues);
      image = decoded.value;
    }
  } catch (error) {
    if (error instanceof ExistingMediaError || error instanceof VideoUploadError) {
      return apiErrorResponse(error.status, error.message, { route: ROUTE, code: error.code });
    }
    logger.error('[publish-existing] media verification failed', error, { userId });
    return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
      route: ROUTE,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
  return { taskRecord, uploadRow, image };
}

export const POST = withApiErrorReporting(ROUTE, postHandler, { getUserId: resolveReportingUserId });
