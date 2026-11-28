import { NextResponse } from 'next/server';

import { apiErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { isPersonaAllowed, isScopedApiKey } from '@/lib/api-keys';
import { trackApiEvent } from '@/lib/analytics';
import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { PUBLISH_EXISTING_NAMESPACE, resolveIdempotency } from '@/lib/idempotency';
import { logger } from '@/lib/logger';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { requireSupabaseSession } from '@/lib/request-auth';
import { assertAccessActive } from '@/lib/access';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  VideoUploadError,
  assertUploadFitsProviders,
  createSupabaseVideoUploadStore,
  type VideoUploadRow,
} from '@/lib/videos/signed-upload';
import { assertUploadNotScheduled } from '@/lib/videos/upload-slot-reference';
import { scheduleAccountColumns } from './account-columns';
import { discardStagedImage, rollbackSlotInsert, slotMediaColumns, stageSlotMedia } from './slot-media';
import {
  SCHEDULE_PK_CONSTRAINT,
  violatedConstraint,
} from './constraint-violations';
import { rejectInvalidRequest } from './invalid-request';
import { checkPromptVersion } from './prompt-version';
import { buildSlotRows } from './slot-rows';
import { resolvePublishAccounts } from './resolve-accounts';
import { invalid } from './validation-issues';
import {
  asapReplayResponse,
  asapScopeKey,
  claimAsapLedger,
  hasGrantedAccounts,
  publishExistingMediaAsap,
  releaseAsapLedger,
  type AsapLedger,
} from './asap';
import { replayAsapHold, scheduleAsapHold } from './asap-hold';
import type { PublishExistingContext } from './context';
import {
  checkPublishExistingSemantics,
  decodeImageMedia,
  parsePublishExistingBody,
  type ImageContentType,
} from './schema';
import {
  ExistingMediaError,
  loadReadyVideoUpload,
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

  const staged = await stageSlotMedia(ctx, slotAt);
  if ('error' in staged) return staged.error;
  const media = staged.media;

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
  });
  if (scheduleError) {
    await discardStagedImage(supabase, media, scheduleId, userId);
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
    promptVersionId: input.promptVersionId,
    firstComment: input.firstComment,
  }).map((row) => ({
    ...row,
    status: ctx.approvalMode === 'approval' ? 'awaiting_approval' : 'ready',
    ...slotMediaColumns(media),
  }));
  const { data: inserted, error: slotsError } = await supabase
    .from('scheduled_posts')
    .insert(rows)
    .select('id, slot_at, title, status');
  if (slotsError || inserted === null) {
    return rollbackSlotInsert(ctx, slotsError, media, scheduleId);
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
  const blocked = await assertAccessActive(userId, { route: ROUTE });
  if (blocked) return blocked;

  const supabase = createSupabaseServiceClient();
  const { personaId } = input;
  if (personaId !== null && !isPersonaAllowed(auth.personaIds, personaId)) {
    return apiErrorResponse(403, formatErrorMessage(ERROR_CODES.PERSONA_SCOPE_DENIED), {
      route: ROUTE,
      code: ERROR_CODES.PERSONA_SCOPE_DENIED,
      field: 'personaId',
    });
  }

  if (input.promptVersionId !== undefined) {
    const version = await checkPromptVersion(supabase, {
      versionId: input.promptVersionId,
      userId,
      allowOwn: !isScopedApiKey(auth),
    });
    if (version === 'error') {
      return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
        route: ROUTE,
        code: ERROR_CODES.INTERNAL_ERROR,
      });
    }
    if (version === 'not_found') {
      return apiErrorResponse(404, 'Unknown promptVersionId: pass the versionId returned with a prompt you can read.', {
        route: ROUTE,
        code: ERROR_CODES.PROMPT_NOT_FOUND,
        field: 'promptVersionId',
      });
    }
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
  if (input.publishing.mode === 'asap' && auth.approvalMode === 'approval') {
    const holdReplay = await replayAsapHold(supabase, idem.scheduleId, userId, ROUTE);
    if (holdReplay !== null) return holdReplay;
  }
  if (resolved instanceof NextResponse) return resolved;
  const { accountIds } = resolved;

  let ledger: AsapLedger | null = null;
  if (input.publishing.mode === 'asap' && idem.clientSupplied && auth.approvalMode !== 'approval') {
    try {
      ledger = await claimAsapLedger(asapScopeKey(idem.scheduleId), userId, input.publishing.providers, accountIds);
    } catch (error) {
      logger.error('[publish-existing] publish ledger claim failed', error, { userId, logId });
      return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
        route: ROUTE,
        code: ERROR_CODES.INTERNAL_ERROR,
      });
    }
    if (!hasGrantedAccounts(ledger)) return asapReplayResponse(input, userId, logId, ledger, reconnectWarning);
  }

  const verified = await verifyMedia(supabase, auth, input);
  if (verified instanceof NextResponse) {
    if (ledger !== null) await releaseAsapLedger(ledger, 'media verification failed');
    return verified;
  }

  let aiLabel = false;
  if (personaId !== null && input.publishing.mode === 'asap') {
    const { data: personaRow, error: personaError } = await supabase
      .from('personas')
      .select('ai_label')
      .eq('id', personaId)
      .eq('user_id', userId)
      .maybeSingle();
    if (personaError) {
      if (ledger !== null) await releaseAsapLedger(ledger, personaError);
      logger.error('[publish-existing] persona ai_label lookup failed', personaError, { userId });
      return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
        route: ROUTE,
        code: ERROR_CODES.INTERNAL_ERROR,
      });
    }
    aiLabel = personaRow?.ai_label === true;
  }

  const ctx: PublishExistingContext = { route: ROUTE, supabase, userId, request, input, accountIds, reconnectWarning, aiLabel, approvalMode: auth.approvalMode ?? 'yolo', ...verified, logId, startTime };
  if (input.publishing.mode === 'scheduled') {
    return scheduleExistingMedia(ctx);
  }
  if (ctx.approvalMode === 'approval') {
    return scheduleAsapHold(ctx, idem.scheduleId);
  }
  return publishExistingMediaAsap(ctx, ledger);
}

interface VerifiedMedia {
  uploadRow: VideoUploadRow | null;
  image: { buffer: Buffer; contentType: ImageContentType } | null;
}

async function verifyMedia(
  supabase: PublishExistingContext['supabase'],
  auth: { userId: string },
  input: PublishExistingContext['input'],
): Promise<VerifiedMedia | NextResponse> {
  const { userId } = auth;
  let uploadRow: VideoUploadRow | null = null;
  let image: { buffer: Buffer; contentType: ImageContentType } | null = null;
  try {
    if (input.media.kind === 'upload') {
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
  return { uploadRow, image };
}

export const POST = withApiErrorReporting(ROUTE, postHandler, { getUserId: resolveReportingUserId });
