import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { isPersonaAllowed } from '@/lib/api-keys';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { type DistributedSlot } from '@/lib/schedule/slot-distribution';
import { validateSlots } from './slot-validation';
import { isValidTimezone } from '@/lib/timezone';
import { computeVideoTokens, toFiniteNumber } from '@/lib/tokens';
import { refundSlotTokens } from '@/lib/billing/refund-tokens';
import { buildSlotRows } from './slot-rows';
import { answerSchedulePkRace } from './pk-race';
import { fetchReplay } from './replay';
import { resolvePriorSpend } from './prior-spend';
import { refundRollbackSpend } from './rollback-refund';
import { buildPairFacts, checkExperimentLink, verifyExperimentPairAfterInsert } from './experiment-link';
import { buildIdentitySnapshot } from './identity-snapshot';
import { resolveEffectiveCta, validateCtaTake } from './cta-validation';
import { scheduleAccountColumns } from './account-columns';
import { checkPreChargePreflights } from './aspect-preflight';
import { resolvePreChargeFallbackPhotos } from './library-photo';
import { loadBoundPublishingAccounts, resolvePublishingAccounts, signedUrl } from './persona-prep';
import { scheduleWarnings } from './schedule-warnings';
import { validateAccounts } from './validate-accounts';
import { GenerateAndScheduleBodySchema, type GenerateAndScheduleBody } from '@/lib/contracts/videos';
import { rawKeyIssues } from './request-title';
import { checkSemantics, rejectInvalidRequest, shapeIssues } from './request-validation';
import {
  persistVoiceSwap,
  preparePost,
  SlotDispatchError,
  coded,
  validationFailed,
} from './prepare-persona';
import { violatedConstraint, SCHEDULE_PK_CONSTRAINT, SCHEDULES_PERSONA_OWNER_CONSTRAINT } from './constraint-violations';
import {
  buildJobPayload,
  hasNonEmptyString,
  type JobPersona,
} from '@/lib/generation/video-job-payload';
import { recordGenerationStart, recordGenerationUpdate, startEngineVideoTask } from '@/lib/generation/video-generation';
import { checkCustomAudioUrl } from '@/lib/generation/custom-audio';
import { deleteInsertedSlots } from './rollback-slots';
import { recordRecentImageId, resolveVideoImage } from '@/lib/persona-images';
import { resolveIdempotency } from '@/lib/idempotency';
import { trackApiEvent } from '@/lib/analytics';
import { logger } from '@/lib/logger';
import { ensureEngineImageUrl } from '@/lib/engine-image-url';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

const ROUTE = 'POST /api/videos/generate-and-schedule';


interface SlotResult {
  slotId: string;
  slotAt: string;
  title: string;
  taskId: string | null;
  status: string;
  errorCode?: string;
  tokensRefunded?: boolean;
}

type PublishMode = 'scheduled' | 'asap';

interface ResolvedPublishPlan {
  mode: PublishMode;
  slots: DistributedSlot[];
  times: string[];
  timezone: string;
}

function validatePublishMode(
  publishing: GenerateAndScheduleBody['publishing'],
  now: Date,
): ResolvedPublishPlan | NextResponse {
  const mode: PublishMode = publishing.mode ?? 'scheduled';
  if (mode === 'asap') {
    if (publishing.schedule !== undefined) {
      return validationFailed(
        ERROR_CODES.VALIDATION_FAILED,
        "publishing.schedule must not be set when publishing.mode is 'asap'.",
        'publishing.schedule',
      );
    }
    const timezone = publishing.timezone?.trim() || 'UTC';
    if (!isValidTimezone(timezone)) {
      return validationFailed(
        ERROR_CODES.VALIDATION_FAILED,
        `Invalid timezone: "${publishing.timezone}".`,
        'publishing.timezone',
      );
    }
    const slots: DistributedSlot[] = [
      { slotAtISO: now.toISOString(), dayIndex: 0, timeIndex: 0 },
    ];
    return { mode, slots, times: [], timezone };
  }
  if (publishing.schedule === undefined) {
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      "publishing.schedule is required when publishing.mode is 'scheduled'.",
      'publishing.schedule',
    );
  }
  const { schedule } = publishing;
  const slots = validateSlots(schedule.startAt, schedule.times, schedule.timezone, 1);
  if (slots instanceof NextResponse) return slots;
  return {
    mode,
    slots,
    times: schedule.times,
    timezone: schedule.timezone,
  };
}

async function postHandler(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'Invalid JSON payload.');
  }
  const rawIssues = rawKeyIssues(body);
  const parsed = GenerateAndScheduleBodySchema.safeParse(body);
  if (!parsed.success) return rejectInvalidRequest([...rawIssues, ...shapeIssues(parsed.error)]);
  const { publishing, options, idempotencyKey, experiment, cta: ctaOverride } = parsed.data;

  const personaId = parsed.data.personaId?.trim() || null;
  const checked = checkSemantics({
    title: parsed.data.title,
    description: parsed.data.description,
    segments: options?.segments,
    providers: publishing.providers,
    options: options ?? {},
    personaId, pinterestBoardId: publishing.pinterestBoardId,
  });
  if (rawIssues.length > 0 || !checked.ok) {
    return rejectInvalidRequest([...rawIssues, ...(checked.ok ? [] : checked.issues)]);
  }
  const { title, description, script: segmentsScript, providers, options: validatedOptions, pinterestBoardId } = checked.value;

  const plan = validatePublishMode(publishing, new Date());
  if (plan instanceof NextResponse) return plan;
  const { mode, slots, times, timezone } = plan;

  if (validatedOptions.audioUrl !== undefined) {
    const audioCheck = await checkCustomAudioUrl(validatedOptions.audioUrl);
    if (!audioCheck.ok) {
      return validationFailed(ERROR_CODES.VALIDATION_FAILED, audioCheck.error, 'options.audioUrl');
    }
  }

  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const userId = auth.userId;

  const limited = await applyRateLimit(request, RATE_LIMITS.generateAndSchedule, userId);
  if (limited) {
    const retryAfter = limited.headers.get('Retry-After') ?? '60';
    trackApiEvent('video_creation_validation_failed', { errorCode: ERROR_CODES.RATE_LIMIT_EXCEEDED, userId });
    const response = coded(429, ERROR_CODES.RATE_LIMIT_EXCEEDED, formatErrorMessage(ERROR_CODES.RATE_LIMIT_EXCEEDED), undefined, {
      retryAfterSeconds: Number(retryAfter),
    });
    response.headers.set('Retry-After', retryAfter);
    return response;
  }

  const supabase: SupabaseClient = createSupabaseServiceClient();

  trackApiEvent('video_creation_started', {
    userId,
    personaId,
    numberOfVideos: 1,
    providers,
    videoType: validatedOptions.videoType,
  });

  if (personaId !== null && !isPersonaAllowed(auth.personaIds, personaId)) {
    return validationFailed(ERROR_CODES.PERSONA_SCOPE_DENIED, formatErrorMessage(ERROR_CODES.PERSONA_SCOPE_DENIED), 'personaId', 403);
  }
  const prep = await preparePost(supabase, userId, personaId, {
    videoType: validatedOptions.videoType,
    audioUrl: validatedOptions.audioUrl,
    imageId: validatedOptions.imageId,
    voiceId: validatedOptions.voiceId,
    videoAspect: validatedOptions.videoAspect,
    videoLayout: validatedOptions.videoLayout,
    paragraphNumber: validatedOptions.paragraphNumber,
    language: validatedOptions.language,
    niche: validatedOptions.niche,
  });
  if (prep instanceof NextResponse) return prep;

  const effectiveCta = resolveEffectiveCta(ctaOverride, prep.cta);
  const ctaCheck = validateCtaTake(effectiveCta, options?.segments);
  if (!ctaCheck.ok) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, ctaCheck.message, ctaCheck.field);
  }

  const bound = await loadBoundPublishingAccounts(supabase, personaId, userId);
  if (bound instanceof NextResponse) return bound;
  const validatedAccounts = await validateAccounts(
    supabase,
    userId,
    providers,
    await resolvePublishingAccounts(supabase, personaId, publishing.accounts, bound ?? undefined, userId),
    bound,
  );
  if (validatedAccounts instanceof NextResponse) return validatedAccounts;
  const { accountIds, reconnectWarning } = validatedAccounts;
  const warnings = scheduleWarnings(prep.voiceFallback, reconnectWarning);

  const requestedImageId =
    personaId !== null ? (validatedOptions.imageId?.trim() || null) : null;
  const fallbackPhotos = await resolvePreChargeFallbackPhotos(supabase, {
    personaId,
    userId,
    title,
    script: segmentsScript,
    videoType: validatedOptions.videoType,
    requestedImageId,
    prep,
  });
  if (fallbackPhotos instanceof NextResponse) return fallbackPhotos;

  const preflight = await checkPreChargePreflights({
    userId,
    script: segmentsScript,
    prep,
    options: validatedOptions,
    segments: options?.segments,
    libraryPhotoUrl: fallbackPhotos.libraryPhotoUrl,
    photoPathUrl: fallbackPhotos.photoPathUrl,
  });
  if (preflight instanceof NextResponse) return preflight;

  const idem = resolveIdempotency(userId, idempotencyKey, request);
  const pairFacts = buildPairFacts({ providers, accountIds, pinterestBoardId, prep, title, segments: options?.segments, videoType: validatedOptions.videoType, audioUrl: validatedOptions.audioUrl, cta: effectiveCta });
  if (experiment !== undefined) {
    const link = await checkExperimentLink(supabase, { link: experiment, userId, personaId, replayScheduleId: idem.scheduleId, facts: pairFacts });
    if (!link.ok && link.status === 500) return coded(500, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
    if (!link.ok) return validationFailed(ERROR_CODES.VALIDATION_FAILED, link.message, link.field, link.status);
  }

  const perVideoCost = computeVideoTokens(validatedOptions.videoType, prep.faceQuality);
  trackApiEvent('video_creation_validated', {
    userId,
    personaId,
    numberOfVideos: 1,
    providers,
    videoType: validatedOptions.videoType,
  });
  trackApiEvent('video_tokens_calculated', {
    userId,
    personaId,
    numberOfVideos: 1,
    perVideoCost,
    tokenCost: perVideoCost,
  });

  const { data: existingSchedule, error: scheduleLookupError } = await supabase
    .from('schedules')
    .select('id')
    .eq('id', idem.scheduleId)
    .eq('user_id', userId)
    .maybeSingle();
  if (scheduleLookupError) {
    logger.error('[generate-and-schedule] idempotency schedule lookup failed', scheduleLookupError, {
      scheduleId: idem.scheduleId,
      userId,
    });
    return coded(500, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
  }
  if (existingSchedule) {
    const { count: slotCount, error: slotCountError } = await supabase
      .from('scheduled_posts')
      .select('id', { count: 'exact', head: true })
      .eq('schedule_id', idem.scheduleId)
      .eq('user_id', userId);
    if (slotCountError) {
      logger.error('[generate-and-schedule] zombie schedule slot count failed', slotCountError, {
        scheduleId: idem.scheduleId,
        userId,
      });
      return coded(500, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
    }
    if ((slotCount ?? 0) === 0) {
      logger.warn('[generate-and-schedule] deleting zombie schedule with 0 slots', {
        scheduleId: idem.scheduleId,
        userId,
      });
      await supabase.from('schedules').delete().eq('id', idem.scheduleId).eq('user_id', userId);
    } else {
      trackApiEvent('video_creation_replayed', { userId, scheduleId: idem.scheduleId });
      const replayed = await fetchReplay(supabase, userId, idem.scheduleId, warnings);
      if (replayed) return replayed;
    }
  }
  const priorSpend = await resolvePriorSpend(supabase, {
    userId,
    scheduleId: idem.scheduleId,
    generationId: idem.generationId,
    scheduleWasLive: existingSchedule !== null && existingSchedule !== undefined,
  });
  if (!('alreadySpent' in priorSpend)) return priorSpend;
  const { alreadySpent } = priorSpend;

  if (!alreadySpent) {
    try {
      await supabase.rpc('grant_signup_bonus', { p_user_id: userId });
    } catch {
    }
    const { data: spendData, error: spendError } = await supabase.rpc('spend_tokens', {
      p_user_id: userId,
      p_amount: perVideoCost,
      p_generation_id: idem.generationId,
      p_reason: 'Unified generate+schedule (1 video)',
    });
    if (spendError) {
      if (violatedConstraint(spendError) !== null) {
        const replayed = await fetchReplay(supabase, userId, idem.scheduleId, warnings);
        if (replayed) {
          trackApiEvent('video_creation_replayed', { userId, scheduleId: idem.scheduleId });
          return replayed;
        }
      }
      logger.error('[generate-and-schedule] atomic spend failed', spendError, { userId, generationId: idem.generationId });
      trackApiEvent('video_creation_failed', { userId, errorCode: ERROR_CODES.INTERNAL_ERROR, failureStage: 'spend' });
      return coded(500, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
    }
    const spendRecord = (spendData ?? {}) as { spent?: boolean; balance?: unknown };
    if (spendRecord.spent !== true) {
      const have = toFiniteNumber(spendRecord.balance, 0);
      trackApiEvent('video_creation_validation_failed', {
        userId,
        personaId,
        errorCode: ERROR_CODES.INSUFFICIENT_TOKENS,
        tokenCost: perVideoCost,
      });
      return coded(402, ERROR_CODES.INSUFFICIENT_TOKENS, formatErrorMessage(ERROR_CODES.INSUFFICIENT_TOKENS, { need: perVideoCost, have }), undefined, {
        have,
        need: perVideoCost,
      });
    }
  }
  trackApiEvent('video_tokens_spent', {
    userId,
    personaId,
    numberOfVideos: 1,
    tokenCost: perVideoCost,
    generationId: idem.generationId,
  });

  if (prep.voiceFallback !== undefined && personaId !== null) {
    await persistVoiceSwap(supabase, userId, personaId, prep.voiceFallback);
  }

  const sortedTimes = [...new Set(times.map((t) => t.trim()))].sort();
  const { error: scheduleError } = await supabase.from('schedules').insert({
    id: idem.scheduleId,
    user_id: userId,
    persona_id: personaId,
    providers,
    ...scheduleAccountColumns(accountIds), pinterest_board_id: pinterestBoardId,
    days_of_week: null, start_hour: null, end_hour: null,
    posts_per_day: 1,
    times: sortedTimes,
    timezone,
    scheduled_at: null,
    active: true,
    publish_mode: mode,
    ...buildIdentitySnapshot(prep, validatedOptions.audioUrl, effectiveCta),
  });
  if (scheduleError) {
    const constraint = violatedConstraint(scheduleError);
    if (constraint === SCHEDULES_PERSONA_OWNER_CONSTRAINT) {
      logger.error('[generate-and-schedule] persona already has a schedule; refunding redundant spend', scheduleError, {
        scheduleId: idem.scheduleId,
        userId,
        personaId,
      });
      if (!alreadySpent) {
        await refundRollbackSpend(supabase, {
          userId,
          generationId: idem.generationId,
          amount: perVideoCost,
          reason: 'Persona already scheduled; refunded redundant spend',
          failureLog: '[generate-and-schedule] persona-already-scheduled refund failed',
        });
      }
      trackApiEvent('video_creation_failed', {
        userId,
        scheduleId: idem.scheduleId,
        errorCode: ERROR_CODES.PERSONA_ALREADY_SCHEDULED,
        failureStage: 'schedule_insert',
      });
      return coded(409, ERROR_CODES.PERSONA_ALREADY_SCHEDULED, formatErrorMessage(ERROR_CODES.PERSONA_ALREADY_SCHEDULED));
    }
    if (constraint === SCHEDULE_PK_CONSTRAINT) {
      return answerSchedulePkRace(supabase, {
        userId,
        scheduleId: idem.scheduleId,
        generationId: idem.generationId,
        perVideoCost,
        alreadySpent,
        scheduleError,
        constraint,
        warnings,
      });
    }
    logger.error('[generate-and-schedule] schedule insert failed after spend; refunding', scheduleError, {
      scheduleId: idem.scheduleId,
      userId,
    });
    await refundRollbackSpend(supabase, {
      userId,
      generationId: idem.generationId,
      amount: perVideoCost,
      reason: 'Unified generate+schedule: schedule insert failed; tokens refunded',
      failureLog: '[generate-and-schedule] refund after schedule insert failure failed',
    });
    trackApiEvent('video_creation_failed', { userId, errorCode: ERROR_CODES.INTERNAL_ERROR, failureStage: 'schedule_insert' });
    return coded(500, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
  }
  trackApiEvent('video_schedule_created', {
    userId,
    personaId,
    scheduleId: idem.scheduleId,
    numberOfVideos: 1,
    providers,
    publishMode: mode,
  });

  const { data: slotRows, error: slotsError } = await supabase
    .from('scheduled_posts')
    .insert(
      buildSlotRows({
        slots,
        title,
        description,
        scheduleId: idem.scheduleId,
        userId,
        videoType: validatedOptions.videoType,
        musicMood: validatedOptions.musicMood,
        chargedTokens: perVideoCost,
        segments: options?.segments,
        experiment,
      }),
    )
    .select('id, slot_at, title');
  if (slotsError || !slotRows || slotRows.length !== 1) {
    logger.error('[generate-and-schedule] slot insert failed; rolling back schedule', slotsError, {
      scheduleId: idem.scheduleId,
      userId,
    });
    await deleteInsertedSlots(supabase, userId, slotRows);
    await supabase.from('schedules').delete().eq('id', idem.scheduleId).eq('user_id', userId);
    await refundRollbackSpend(supabase, {
      userId,
      generationId: idem.generationId,
      amount: perVideoCost,
      reason: 'Unified generate+schedule: slot insert failed; tokens refunded',
    });
    trackApiEvent('video_creation_failed', { userId, scheduleId: idem.scheduleId, errorCode: ERROR_CODES.INTERNAL_ERROR, failureStage: 'slot_insert' });
    return coded(500, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
  }
  trackApiEvent('video_slots_created', { userId, scheduleId: idem.scheduleId, numberOfVideos: 1 });
  if (experiment !== undefined) {
    const recheck = await verifyExperimentPairAfterInsert(supabase, { link: experiment, userId, facts: pairFacts });
    if (!recheck.ok) {
      logger.error('[generate-and-schedule] experiment pair re-check failed after insert; rolling back', undefined, { scheduleId: idem.scheduleId, userId, field: recheck.field });
      await deleteInsertedSlots(supabase, userId, slotRows);
      await supabase.from('schedules').delete().eq('id', idem.scheduleId).eq('user_id', userId);
      await refundRollbackSpend(supabase, {
        userId,
        generationId: idem.generationId,
        amount: perVideoCost,
        reason: 'Unified generate+schedule: experiment pair mismatch; tokens refunded',
      });
      trackApiEvent('video_creation_failed', { userId, scheduleId: idem.scheduleId, errorCode: ERROR_CODES.VALIDATION_FAILED, failureStage: 'experiment_pair' });
      if (recheck.status === 500) return coded(500, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
      return validationFailed(ERROR_CODES.VALIDATION_FAILED, recheck.message, recheck.field, recheck.status);
    }
  }

  const results: SlotResult[] = [];
  let accepted = 0;
  let failed = 0;
  const recentIds: string[] = [];
  for (let i = 0; i < slotRows.length; i += 1) {
    const slot = slotRows[i] as { id: string; slot_at: string; title: string };
    const slotGenerationId = `${idem.generationId}:slot:${slot.id}`;
    try {
      let photoUrl: string | undefined;
      let pickedImageId: string | null = null;
      if (validatedOptions.videoType !== 'faceless' && personaId !== null) {
        const selection = await resolveVideoImage(supabase, personaId, userId, recentIds, {
          title,
          niche: prep.niche,
          script: segmentsScript,
          imageId: requestedImageId,
        });
        if (!selection.ok) {
          throw new SlotDispatchError('image_resolve_failed', selection.error);
        }
        if (selection.image) {
          const libraryUrl = await signedUrl(supabase, selection.image.image_path);
          if (!libraryUrl) {
            throw new SlotDispatchError('image_sign_failed', 'The selected persona image could not be loaded. Please try again.');
          }
          photoUrl = libraryUrl;
          if (!requestedImageId) pickedImageId = selection.image.id;
        } else {
          const hosted = await ensureEngineImageUrl(prep.avatarUrl, {
            supabase,
            userId,
            origin: new URL(request.url).origin,
          }).catch((error: unknown) => {
            throw new SlotDispatchError(
              'photo_resolve_failed',
              error instanceof Error ? error.message : 'The chosen character could not be loaded.',
            );
          });
          photoUrl = hosted ?? (await signedUrl(supabase, prep.photoPath)) ?? undefined;
        }
        if (!photoUrl && prep.photoRequired) {
          throw new SlotDispatchError('photo_missing', 'Persona photo could not be loaded. Please try again.');
        }
      }

      const jobPersona: JobPersona = {
        name: prep.personaName,
        photo_url: photoUrl,
        voice_id: prep.voiceAudioUrl ? undefined : prep.voiceIdValue,
        voice_audio_url: prep.voiceAudioUrl,
        language: prep.language,
        video_aspect: prep.videoAspect,
        video_layout: prep.videoLayout,
        paragraph_number: prep.paragraphNumber,
        niche: prep.niche,
        face_quality: prep.faceQuality,
      };
      const payload = buildJobPayload(jobPersona, {
        video_title: title, video_description: description,
        video_type: validatedOptions.videoType,
        video_script: segmentsScript,
        webhook_url: validatedOptions.webhookUrl,
        cta_type: effectiveCta?.type ?? null,
        generation_id: slotGenerationId,
        slot_id: slot.id,
        music_mood: validatedOptions.musicMood,
        segments: options?.segments,
      });
      if (!hasNonEmptyString(payload.video_title)) {
        throw new SlotDispatchError('empty_title', 'Video title is empty.');
      }

      await recordGenerationStart({
        supabase,
        userId,
        generationId: slotGenerationId,
        personaId,
        personaName: prep.personaName,
        videoSubject: title,
        persistence: { params: payload, mode, slotAt: slot.slot_at },
      });

      const engineTask = await startEngineVideoTask(userId, payload);
      if (!engineTask.ok || !engineTask.taskId) {
        const errorCode = !engineTask.ok
          ? engineTask.upstreamStatus !== undefined
            ? 'engine_rejected'
            : 'engine_unavailable'
          : 'no_task_id';
        throw new SlotDispatchError(errorCode, 'Video service is unavailable. Please try again later.');
      }

      const { error: bindError } = await supabase
        .from('scheduled_posts')
        .update({ status: 'generating', task_id: engineTask.taskId })
        .eq('id', slot.id)
        .eq('user_id', userId);
      if (bindError) {
        logger.error('[generate-and-schedule] task_id bind failed after engine accept', bindError, {
          slotId: slot.id,
          taskId: engineTask.taskId,
          scheduleId: idem.scheduleId,
        });
        throw new SlotDispatchError('bind_failed', 'Video generation started but the slot could not be linked. Contact support with the schedule ID.');
      }

      await recordGenerationUpdate({
        supabase,
        generationId: slotGenerationId,
        status: 'running',
        engineTaskId: engineTask.taskId,
      });
      if (pickedImageId && personaId !== null) {
        await recordRecentImageId(supabase, personaId, pickedImageId, userId);
        recentIds.push(pickedImageId);
      }

      results.push({ slotId: slot.id, slotAt: slot.slot_at, title, taskId: engineTask.taskId, status: 'generating' });
      accepted += 1;
    } catch (error) {
      const dispatchError = error instanceof SlotDispatchError ? error : new SlotDispatchError('slot_failed', 'Video generation failed for this slot.');
      await supabase.from('scheduled_posts').update({ status: 'failed' }).eq('id', slot.id).eq('user_id', userId);
      const { refunded, error: refundError } = await refundSlotTokens({
        supabase,
        userId,
        scheduleId: idem.scheduleId,
        slotId: slot.id,
        amount: perVideoCost,
        reason: 'Unified generate+schedule: slot dispatch failed; video refunded',
        kind: 'dispatch_failed',
      });
      if (refundError) {
        logger.error('[generate-and-schedule] per-slot refund failed', refundError, {
          slotId: slot.id,
          generationId: idem.generationId,
          userId,
        });
      }
      await recordGenerationUpdate({
        supabase,
        generationId: slotGenerationId,
        status: 'failed',
        errorCode: dispatchError.errorCode,
        errorMessage: dispatchError.message,
        tokensRefunded: refunded,
      });
      logger.error('[generate-and-schedule] slot dispatch failed', error, {
        slotId: slot.id,
        title,
        scheduleId: idem.scheduleId,
        errorCode: dispatchError.errorCode,
      });
      results.push({ slotId: slot.id, slotAt: slot.slot_at, title, taskId: null, status: 'failed', errorCode: dispatchError.errorCode, tokensRefunded: refunded });
      failed += 1;
    }
  }

  trackApiEvent('video_tasks_created', {
    userId,
    personaId,
    scheduleId: idem.scheduleId,
    tasksAccepted: accepted,
    tasksFailed: failed,
  });

  const durationMs = Date.now() - startedAt;
  const envelope = {
    schedule: { id: idem.scheduleId, mode },
    slots: results,
    replayed: false,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
  if (failed > 0 && accepted === 0) {
    const engineOutage = results.every((r) =>
      ['engine_rejected', 'engine_unavailable', 'no_task_id'].includes(r.errorCode ?? ''),
    );
    const code = engineOutage ? ERROR_CODES.ENGINE_UNAVAILABLE : ERROR_CODES.INTERNAL_ERROR;
    trackApiEvent('video_creation_failed', {
      userId,
      personaId,
      scheduleId: idem.scheduleId,
      errorCode: code,
      failureStage: 'dispatch',
      numberOfVideos: 1,
      durationMs,
      refunded: results.every((r) => r.status !== 'failed' || r.tokensRefunded === true),
    });
    return NextResponse.json(
      { success: false, error: formatErrorMessage(code), code, ...envelope },
      { status: 502 },
    );
  }

  trackApiEvent('video_creation_completed', {
    userId,
    personaId,
    scheduleId: idem.scheduleId,
    numberOfVideos: 1,
    tasksAccepted: accepted,
    tasksFailed: failed,
    tokenCost: perVideoCost,
    durationMs,
  });

  return NextResponse.json({ success: true, ...envelope });
}

export const POST = withApiErrorReporting(ROUTE, postHandler, { getUserId: resolveReportingUserId });
