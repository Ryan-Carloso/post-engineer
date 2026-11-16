//---------------
// POST /api/media/publish-existing — publish or schedule existing media
// (issue #384). Three kinds, no generation on any of them:
//
//   task   — a finished engine video, by task id. Scheduled posts ride the
//            engine's own tick (the slot keeps its task_id, status ready);
//            ASAP downloads the finished video and dispatches it now.
//   upload — a ready signed-upload video, by upload id. ASAP claims it once
//            and dispatches; scheduled holds the row (expiry extended to
//            the slot time + 24h) for the engine to claim at publish time.
//   image  — plain image bytes, inline (<= 8 MB). Instagram only for now:
//            its handler is the only one that accepts images. ASAP posts it
//            directly; scheduled stores the bytes in the `uploads` bucket
//            and the slot points at the path.
//
// No generation tokens are charged on this path (charged_tokens = 0), so
// cancelling never refunds. Title + description stay required (issue #542),
// the persona-account rule from issue #572 applies (a persona must have
// >= 1 bound account; publish only to bound accounts), and the schedule
// window is the same 3h–30d as generate-and-schedule.
//---------------

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

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
import { buildUploadErrorResponse } from '@/lib/upload/handlers';
import { accountFailure } from '@/lib/upload/account-error';
import type { ContentUploadAccountResult } from '@/lib/upload/content-upload-result';
import { dispatchPublish } from '@/lib/videos/publish-uploaded';
import {
  VideoUploadError,
  claimUploadForPublish,
  createSupabaseVideoUploadStore,
  createSupabaseVideoUploadStorage,
  type VideoUploadRow,
} from '@/lib/videos/signed-upload';
import { scheduleAccountColumns } from '../../videos/generate-and-schedule/account-columns';
import {
  SCHEDULE_PK_CONSTRAINT,
  violatedConstraint,
} from '../../videos/generate-and-schedule/constraint-violations';
import { resolvePublishingAccounts } from '../../videos/generate-and-schedule/persona-prep';
import { rejectInvalidRequest } from '../../videos/generate-and-schedule/request-validation';
import { buildSlotRows } from '../../videos/generate-and-schedule/slot-rows';
import { validateSlots } from '../../videos/generate-and-schedule/slot-validation';
import { validateAccounts } from '../../videos/generate-and-schedule/validate-accounts';
import { loadPublishBinding } from './bound-accounts';
import type { Provider } from '../../videos/generate-and-schedule/providers-validation';
import { invalid } from '../../videos/generate-and-schedule/validation-issues';
import {
  checkPublishExistingSemantics,
  decodeImageMedia,
  parsePublishExistingBody,
  type ImageContentType,
  type PublishExistingRequest,
  type ScheduledMediaKind,
} from './schema';
import {
  ExistingMediaError,
  downloadEngineTaskVideo,
  fetchScopedEngineTask,
  loadReadyVideoUpload,
  storeScheduledImage,
  type EngineTaskRecord,
} from './media-resolve';
import { buildExistingMediaForm, type ExistingMediaFormFields } from './publish-form';
import { replaySchedule, toSlotSummaries } from './replay';

const ROUTE = 'POST /api/media/publish-existing';

interface PublishExistingContext {
  supabase: SupabaseClient;
  userId: string;
  request: Request;
  input: PublishExistingRequest;
  accountIds: Record<Provider, string[]>;
  taskRecord: EngineTaskRecord | null;
  uploadRow: VideoUploadRow | null;
  image: { buffer: Buffer; contentType: ImageContentType } | null;
  logId: string;
  startTime: number;
}

function mediaKind(input: PublishExistingRequest): 'task' | 'upload' | 'image' {
  return input.media.kind;
}

function fieldsFor(
  input: PublishExistingRequest,
  accountIds: Record<Provider, string[]>,
  provider: Provider,
): ExistingMediaFormFields {
  const caption = input.caption?.trim() ? input.caption.trim() : input.description;
  return {
    title: input.title,
    description: input.description,
    caption,
    tags: input.tags ?? [],
    privacyStatus: input.privacyStatus ?? 'public',
    boardId: input.publishing.pinterestBoardId ?? '',
    accountIds: accountIds[provider] ?? [],
  };
}

async function scheduleExistingMedia(ctx: PublishExistingContext): Promise<NextResponse> {
  const { supabase, userId, input, accountIds } = ctx;
  const schedule = input.publishing.schedule;
  if (schedule === undefined) {
    return apiErrorResponse(400, 'publishing.schedule is required when publishing.mode is \'scheduled\'.', {
      route: ROUTE,
      code: ERROR_CODES.VALIDATION_FAILED,
      field: 'publishing.schedule',
    });
  }
  const slots = validateSlots(schedule.startAt, schedule.times, schedule.timezone, 1);
  if (slots instanceof NextResponse) return slots;
  const slotAt = slots[0]?.slotAtISO;
  if (slotAt === undefined) {
    return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
      route: ROUTE,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
  const idem = resolveIdempotency(userId, input.idempotencyKey, ctx.request, PUBLISH_EXISTING_NAMESPACE);
  const scheduleId = idem.scheduleId;

  // Media prep runs before the schedule insert so a failure here leaves no
  // orphan schedule row behind. The stored image is compensated below if
  // the insert fails afterwards.
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
      // Hold the row until the slot publishes: the sweeper deletes expired
      // ready uploads, so extend the expiry past the slot time.
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

  const sortedTimes = [...new Set(schedule.times.map((time) => time.trim()))].sort();
  const { error: scheduleError } = await supabase.from('schedules').insert({
    id: scheduleId,
    user_id: userId,
    // NULL for a post created without one (migration 012).
    persona_id: input.personaId,
    providers: input.publishing.providers,
    ...scheduleAccountColumns(accountIds),
    pinterest_board_id: input.publishing.pinterestBoardId,
    days_of_week: null,
    start_hour: null,
    end_hour: null,
    posts_per_day: 1,
    times: sortedTimes,
    timezone: schedule.timezone,
    scheduled_at: null,
    active: true,
    publish_mode: 'scheduled',
    // Identity snapshot columns stay NULL: existing media carries no
    // generation identity, and the engine never reads them for a ready slot.
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
      // Lost a PK race with a concurrent duplicate: replay the winner.
      const replay = await replaySchedule(supabase, scheduleId, userId, ROUTE);
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
    // Ready from birth: no generation runs for this slot, so the engine
    // tick picks it up at slot time. Nothing was charged, so a cancel
    // never refunds.
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
    logger.error('[publish-existing] slot insert failed', slotsError, { scheduleId, userId });
    await supabase.from('schedules').delete().eq('id', scheduleId).eq('user_id', userId);
    if (storedImagePath !== null) {
      await supabase.storage
        .from('uploads')
        .remove([storedImagePath])
        .catch((error: unknown) => logger.error('[publish-existing] stored image cleanup failed', error, { scheduleId, userId }));
    }
    return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
      route: ROUTE,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
  trackApiEvent('publish_existing_scheduled', {
    userId,
    scheduleId,
    mediaKind: mediaKind(input),
    providers: input.publishing.providers,
  });
  return NextResponse.json({
    success: true,
    mode: 'scheduled',
    replayed: false,
    schedule: { id: scheduleId },
    slots: toSlotSummaries(inserted),
  });
}

async function dispatchProvider(
  provider: Provider,
  form: FormData,
  ctx: PublishExistingContext,
): Promise<{ provider: string; success: boolean; results: ContentUploadAccountResult[] }> {
  try {
    const result = await dispatchPublish(provider, form, ctx.userId, ctx.logId, ctx.startTime);
    return { provider, success: result.success, results: result.results };
  } catch (error) {
    // A handler throw must not discard the providers that already
    // published: record the failure per account and keep going, so the
    // response always carries every provider's outcome.
    logger.error('[publish-existing] provider publish threw', error, {
      provider,
      logId: ctx.logId,
      userId: ctx.userId,
    });
    const accountIds = ctx.accountIds[provider] ?? [];
    const results =
      accountIds.length > 0
        ? accountIds.map((accountId) => accountFailure(accountId, error))
        : [accountFailure('', error)];
    return { provider, success: false, results };
  }
}

async function publishExistingMediaAsap(ctx: PublishExistingContext): Promise<NextResponse> {
  const { userId, input, accountIds, logId, startTime } = ctx;
  const providers = input.publishing.providers;
  try {
    const publishes: Array<{ provider: string; success: boolean; results: ContentUploadAccountResult[] }> = [];
    if (ctx.image !== null) {
      // Semantics already restricts images to Instagram only; dispatchPublish
      // routes it through the Instagram handler and normalizes the result
      // like every other provider.
      const form = buildExistingMediaForm('instagram', fieldsFor(input, accountIds, 'instagram'), ctx.image.buffer, ctx.image.contentType);
      publishes.push(await dispatchProvider('instagram', form, ctx));
    } else if (ctx.uploadRow !== null) {
      const store = createSupabaseVideoUploadStore();
      const storage = createSupabaseVideoUploadStorage();
      const claimed = await claimUploadForPublish(store, storage, userId, ctx.uploadRow.id, new Date());
      try {
        for (const provider of providers) {
          const form = buildExistingMediaForm(provider, fieldsFor(input, accountIds, provider), claimed.buffer, claimed.contentType);
          publishes.push(await dispatchProvider(provider, form, ctx));
        }
      } finally {
        // Single-use claim: the bytes are gone once dispatched, published
        // or not — exactly like publish-by-id.
        const { error: removeError } = await storage.remove([claimed.row.storage_path]);
        if (removeError) {
          logger.error('[publish-existing] claimed upload cleanup failed', removeError, { uploadId: ctx.uploadRow.id, userId });
        }
      }
    } else if (ctx.taskRecord !== null) {
      const { buffer, contentType } = await downloadEngineTaskVideo(ctx.taskRecord, userId);
      for (const provider of providers) {
        const form = buildExistingMediaForm(provider, fieldsFor(input, accountIds, provider), buffer, contentType);
        publishes.push(await dispatchProvider(provider, form, ctx));
      }
    }
    // YouTube and Instagram handlers report success: true no matter how
    // many accounts failed — their per-account outcomes live in results —
    // so derive each provider's outcome from its account results before
    // aggregating. The response (and the MCP summary built from it) must
    // never claim a publish that never happened.
    const derivedPublishes = publishes.map((publish) => ({
      ...publish,
      success: publish.results.some((result) => result.success),
    }));
    const success = derivedPublishes.every((publish) => publish.success);
    trackApiEvent('publish_existing_asap', {
      userId,
      mediaKind: mediaKind(input),
      providers,
      success,
    });
    return NextResponse.json({ success, mode: 'asap', mediaKind: mediaKind(input), publishes: derivedPublishes, logId });
  } catch (error) {
    if (error instanceof ExistingMediaError) {
      return apiErrorResponse(error.status, error.message, { route: ROUTE, code: error.code });
    }
    if (error instanceof VideoUploadError) {
      return apiErrorResponse(error.status, error.message, { route: ROUTE, code: error.code });
    }
    return buildUploadErrorResponse(error, logId, startTime);
  }
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

  // Scheduled replays answer before any other work: the same key is the
  // same request, and re-running it would re-verify (and, for uploads,
  // re-claim) media the first attempt already handled.
  if (input.publishing.mode === 'scheduled') {
    const idem = resolveIdempotency(userId, input.idempotencyKey, request, PUBLISH_EXISTING_NAMESPACE);
    const replay = await replaySchedule(supabase, idem.scheduleId, userId, ROUTE);
    if (replay !== null) return replay;
  }

  // Persona existence + bound accounts (issue #572): a persona with zero
  // bound accounts cannot publish at all; explicit accounts must be bound.
  const bound = await loadPublishBinding(supabase, personaId, userId, ROUTE);
  if (bound instanceof NextResponse) return bound;
  const resolvedAccounts = await resolvePublishingAccounts(supabase, personaId, input.publishing.accounts, bound ?? undefined, userId);
  const accountIds = await validateAccounts(supabase, userId, input.publishing.providers, resolvedAccounts, bound);
  if (accountIds instanceof NextResponse) return accountIds;

  // Media verification: no side effects yet — a 404/409 here leaves
  // nothing behind to clean up.
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
    } else {
      const decoded = decodeImageMedia(input.media);
      if (!decoded.ok) return rejectInvalidRequest(decoded.issues);
      image = decoded.value;
    }
  } catch (error) {
    if (error instanceof ExistingMediaError) {
      return apiErrorResponse(error.status, error.message, { route: ROUTE, code: error.code });
    }
    throw error;
  }

  const ctx: PublishExistingContext = {
    supabase,
    userId,
    request,
    input,
    accountIds,
    taskRecord,
    uploadRow,
    image,
    logId,
    startTime,
  };
  if (input.publishing.mode === 'scheduled') {
    return scheduleExistingMedia(ctx);
  }
  return publishExistingMediaAsap(ctx);
}

export const POST = withApiErrorReporting(ROUTE, postHandler, { getUserId: resolveReportingUserId });
