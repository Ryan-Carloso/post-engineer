//---------------
// POST /api/videos/generate-and-schedule — the single generate+schedule operation.
//
// Product rule: a video and its publishing schedule are always born together.
// One request carries a title, a complete segments script, a persona and a
// publish-time plan. The API validates everything, charges the single video,
// creates the schedule + its one slot and dispatches one engine generation.
// The topics input is rejected with a 400 naming the field — never mapped.
//
// Backend flow: validate input -> auth -> rate limit -> persona scope +
// ownership -> providers + accounts -> distribute slots -> window check
// -> cost -> idempotency pre-checks -> ONE atomic spend_tokens -> insert
// schedule -> insert slot -> dispatch engine task.
//---------------

import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { isPersonaAllowed } from '@/lib/api-keys';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import {
  distributeSlots,
  SlotDistributionError,
  type DistributedSlot,
} from '@/lib/schedule/slot-distribution';
import { validateScheduleWindow } from '@/lib/schedule-window';
import { isValidTimezone } from '@/lib/timezone';
import { computeVideoTokens, netLedgerSpent, toFiniteNumber, unknownVideoTypeMessage, VIDEO_TYPE_ERROR_SUFFIX } from '@/lib/tokens';
import { buildSlotRows } from './slot-rows';
import { fetchReplay } from './replay';
import { refundRollbackSpend } from './rollback-refund';
import { buildPairFacts, checkExperimentLink, ExperimentLinkSchema, verifyExperimentPairAfterInsert } from './experiment-link';
import type { Provider } from './providers-validation';
import { scheduleAccountColumns } from './account-columns';
import { checkPreChargePreflights } from './aspect-preflight';
import { resolvePublishingAccounts, signedUrl } from './persona-prep';
import { validateAccounts } from './validate-accounts';
import { getPersonaDefaultAccounts } from '@/lib/persona-publishing-accounts';
import { segmentsRequestSchema } from './segments-schema';
import { rawKeyIssues } from './request-title';
import { checkSemantics, MAX_REPORTED_ISSUES, rejectInvalidRequest, shapeIssues } from './request-validation';
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
import { recordRecentImageId, resolveVideoImage } from '@/lib/persona-images';
import { resolveIdempotency } from '@/lib/idempotency';
import { trackApiEvent } from '@/lib/analytics';
import { logger } from '@/lib/logger';
import { VOICE_FALLBACK_WARNING_CODE } from '@/lib/voice-fallback';
import { ensureEngineImageUrl } from '@/lib/engine-image-url';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

const ROUTE = 'POST /api/videos/generate-and-schedule';

//---------------
// Request shape. Semantic checks (codes, fields) run after the shape parse
// so every failure carries a stable code + field.
//---------------
const PublishingScheduleSchema = z.object({
  startAt: z.string(),
  times: z.array(z.string()),
  timezone: z.string(),
});

const PublishingSchema = z.object({
  // 'scheduled' (default): publish at the slot times. 'asap': publish each
  // video the moment generation finishes, with no scheduled time.
  mode: z.enum(['scheduled', 'asap']).optional(),
  providers: z.array(z.string()).max(MAX_REPORTED_ISSUES),
  accounts: z.record(z.string(), z.array(z.string())).optional(), pinterestBoardId: z.string().max(100).optional(),
  // Required in scheduled mode, forbidden in asap mode (a stray plan would
  // be silently ignored, so it is a 400 instead).
  schedule: PublishingScheduleSchema.optional(),
  // ASAP-only: the user's IANA zone, kept for display. Optional because the
  // schedules.timezone column is NOT NULL DEFAULT 'UTC'.
  timezone: z.string().optional(),
});

const OptionsSchema = z
  .object({
    // The one video mode (issue #542 follow-up), required: it decides
    // render path + price. Zod v4 dropped errorMap, so the message lives
    // in `error` (missing -> required, else unknown-mode with costs).
    videoType: z.enum(['full_lipsync', 'hook_lipsync', 'faceless'], {
      error: (issue) => (issue.input === undefined ? `options.videoType is required; ${VIDEO_TYPE_ERROR_SUFFIX}` : unknownVideoTypeMessage(issue.input)),
    }),
    // BGM mood (issue #489): a catalogued mood, or "none" for no music; omitted = engine default.
    musicMood: z.string().min(1).max(64).optional(),
    audioUrl: z.string().optional(),
    imageId: z.string().optional(),
    // Segments contract (MCP first, Phase 1): one call = one video; the
    // joined script becomes the video script, no LLM expands it. The engine's persona script budget and duration trim still apply downstream.
    segments: segmentsRequestSchema.optional(),
    webhookUrl: z.string().optional(),
    voiceId: z.string().optional(),
    // The rest of a persona's editorial definition, for a post created
    // WITHOUT one (migration 012). With a persona these still override it.
    videoAspect: z.enum(['9:16', '16:9', '1:1']).optional(),
    videoLayout: z.enum(['standard', 'react']).optional(),
    paragraphNumber: z.number().int().min(1).max(10).optional(),
    language: z.string().optional(),
    niche: z.string().optional(),
  })
  .optional();

const BodySchema = z.object({
  // Optional: a post without a persona is faceless (options.videoType
  // 'faceless') and defined entirely by options + title + description.
  personaId: z.string().optional(),
  // The slot label. A `topics` key is rejected explicitly in
  // postHandler before this parse (a plain zod object would strip it
  // silently and the caller would think videos were created).
  // At most 100 chars (YouTube's cap): the engine rejects longer titles at dispatch, so fail here, pre-charge.
  title: z.string().max(100, 'title must be at most 100 characters.'),
  // Agent-supplied video description (issue #542 follow-up), REQUIRED: the publish copy. Zod v4 dropped required_error, so the missing-value message lives in `error`.
  description: z.string({ error: (issue) => (issue.input === undefined ? 'description is required: the publish copy for this video.' : undefined) }).min(1, 'description must be a non-empty string: the publish copy for this video.').max(5000, 'description must be at most 5000 characters.'),
  publishing: PublishingSchema,
  options: OptionsSchema,
  idempotencyKey: z.string().optional(),
  // Paired A/B experiment link (issue #476), checked before the charge.
  experiment: ExperimentLinkSchema.optional(),
});

type ParsedBody = z.infer<typeof BodySchema>;

interface SlotResult {
  slotId: string;
  slotAt: string;
  title: string;
  taskId: string | null;
  status: string;
  /** Machine code for a failed slot (image_sign_failed, engine_rejected, ...). */
  errorCode?: string;
}

//---------------
// Small helpers
//---------------

//---------------
// Validation helpers — all run BEFORE any token is charged.
//---------------

function validateSlots(
  startAt: string,
  times: string[],
  timezone: string,
  count: number,
): DistributedSlot[] | NextResponse {
  let slots: DistributedSlot[];
  try {
    slots = distributeSlots({ startAtISO: startAt, times, timezone, count });
  } catch (error) {
    if (error instanceof SlotDistributionError) {
      const field =
        error.field === 'times'
          ? 'publishing.schedule.times'
          : error.field === 'timezone'
            ? 'publishing.schedule.timezone'
            : error.field === 'startAt'
              ? 'publishing.schedule.startAt'
              : 'publishing.schedule';
      const code = error.field === 'times' ? ERROR_CODES.INVALID_SCHEDULE_TIME : ERROR_CODES.VALIDATION_FAILED;
      const message =
        code === ERROR_CODES.INVALID_SCHEDULE_TIME ? formatErrorMessage(code) : error.message;
      return validationFailed(code, message, field);
    }
    throw error;
  }
  // Every slot must fall inside the 3h–30d publishing window.
  for (const slot of slots) {
    const windowCheck = validateScheduleWindow(new Date(slot.slotAtISO));
    if (!windowCheck.ok) {
      return validationFailed(
        ERROR_CODES.SCHEDULE_OUT_OF_RANGE,
        // windowCheck.error is the only copy for this code at this call
        // site: the validator always returns a non-empty message on the
        // failure branch, and it already interpolates the window constants.
        windowCheck.error,
        'publishing.schedule',
      );
    }
  }
  return slots;
}

//---------------
// Publish-mode resolution. 'scheduled' (default) keeps the existing
// contract: a schedule plan with distributed, window-checked slots.
// 'asap' publishes each video the moment generation finishes: no schedule
// plan is accepted (a stray one would be silently ignored, so it is a 400),
// and every slot lands at the request time.
//---------------
type PublishMode = 'scheduled' | 'asap';

interface ResolvedPublishPlan {
  mode: PublishMode;
  slots: DistributedSlot[];
  /** Sorted, deduped daily times (empty for asap). */
  times: string[];
  /** IANA zone stored on the schedule row (display only for asap). */
  timezone: string;
}

function validatePublishMode(
  publishing: ParsedBody['publishing'],
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

//---------------
// Social account validation lives in validate-accounts.ts (extracted so
// the route module stays under the file-size ratchet).
//---------------

async function postHandler(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();

  // 1. Validate input shape + semantics (no DB, no charge).
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'Invalid JSON payload.');
  }
  // Shape, title, segments, providers, options and persona-less rules: all
  // collected, then one 400 with every problem (see request-validation.ts).
  const rawIssues = rawKeyIssues(body);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return rejectInvalidRequest([...rawIssues, ...shapeIssues(parsed.error)]);
  const { publishing, options, idempotencyKey, experiment } = parsed.data;

  // A blank/absent personaId means "post without a persona" (migration 012).
  // Null is the only accepted spelling so a caller cannot half-intend a
  // persona by sending an empty string.
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

  // Publish mode: scheduled (default) distributes slots across the plan's
  // times; asap skips the schedule entirely and lands every slot at the
  // request time, so the engine's tick publishes each video the moment its
  // generation finishes.
  const plan = validatePublishMode(publishing, new Date());
  if (plan instanceof NextResponse) return plan;
  const { mode, slots, times, timezone } = plan;

  // Custom audio SSRF check before auth: fail fast on a hostile URL without
  // spending an auth lookup. (The HEAD check itself is the expensive part;
  // it runs once per request, before any charge.)
  if (validatedOptions.audioUrl !== undefined) {
    const audioCheck = await checkCustomAudioUrl(validatedOptions.audioUrl);
    if (!audioCheck.ok) {
      return validationFailed(ERROR_CODES.VALIDATION_FAILED, audioCheck.error, 'options.audioUrl');
    }
  }

  // 2. Auth.
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const userId = auth.userId;

  // 3. Rate limit: one call mints one video, keyed by user id.
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

  // Service-role bypasses RLS: every query below re-checks ownership with an
  // explicit .eq('user_id', userId) predicate.
  const supabase: SupabaseClient = createSupabaseServiceClient();

  trackApiEvent('video_creation_started', {
    userId,
    personaId,
    numberOfVideos: 1,
    providers,
    videoType: validatedOptions.videoType,
  });

  // 4. Persona scope (API keys) + ownership. A persona-less post has nothing
  // to scope against, so the scope check only applies when one is named.
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
  const voiceFallbackWarning =
    prep.voiceFallback === undefined
      ? null
      : {
        code: VOICE_FALLBACK_WARNING_CODE,
        fromVoice: prep.voiceFallback.fromVoice,
        toVoice: prep.voiceFallback.toVoice,
      };

  // 5. Providers + social accounts (fail fast: never charge for a bad selection).
  // The binding is loaded once here: resolvePublishingAccounts falls back
  // to it when accounts are omitted, and validateAccounts proves every
  // requested id is bound to the persona (issue #572).
  const bound = personaId !== null ? await getPersonaDefaultAccounts(supabase, personaId) : null;
  const accountIds = await validateAccounts(
    supabase,
    userId,
    providers,
    await resolvePublishingAccounts(supabase, personaId, publishing.accounts, bound ?? undefined),
    bound,
  );
  if (accountIds instanceof NextResponse) return accountIds;

  // Pinned library image: fail fast when the id does not resolve, before
  // any charge. Per-video resolution still happens at dispatch time.
  const requestedImageId =
    personaId !== null ? (validatedOptions.imageId?.trim() || null) : null;
  if (requestedImageId && personaId !== null) {
    const imageCheck = await resolveVideoImage(supabase, personaId, userId, [], {
      title,
      niche: prep.niche,
      // Image keyword matching uses the actual segments script now, not
      // the removed prompt: the prompt was only ever a proxy for it.
      script: segmentsScript,
      imageId: requestedImageId,
    });
    if (!imageCheck.ok) {
      return validationFailed(ERROR_CODES.VALIDATION_FAILED, imageCheck.error, 'options.imageId', imageCheck.status);
    }
  }

  // Pre-charge preflights: full lip-sync narration (>60s) and segment-media
  // aspect (issue #538) — both reject here instead of charging then refunding.
  // Runs after all other pre-charge validation, before cost/spend below.
  const preflight = await checkPreChargePreflights({
    userId,
    script: segmentsScript,
    prep,
    options: validatedOptions,
    segments: options?.segments,
  });
  if (preflight instanceof NextResponse) return preflight;

  // Idempotency anchor, resolved once: the experiment check below needs the
  // same schedule id step 7 uses to tell a replay from a duplicate.
  const idem = resolveIdempotency(userId, idempotencyKey, request);
  const pairFacts = buildPairFacts({ providers, accountIds, pinterestBoardId, prep, title, segments: options?.segments, videoType: validatedOptions.videoType, audioUrl: validatedOptions.audioUrl });
  if (experiment !== undefined) {
    const link = await checkExperimentLink(supabase, { link: experiment, userId, personaId, replayScheduleId: idem.scheduleId, facts: pairFacts });
    if (!link.ok && link.status === 500) return coded(500, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
    if (!link.ok) return validationFailed(ERROR_CODES.VALIDATION_FAILED, link.message, link.field, link.status);
  }

  // 6. Cost for the single video, computed BEFORE the charge from the video mode.
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

  // 7. Idempotency: the schedule id is deterministic in (user, key), so a
  // retry addresses the same schedule row instead of creating a duplicate.
  // A 0-slot row is a zombie and is deleted below so the operation runs
  // fresh instead of being replayed empty.
  const { data: existingSchedule, error: scheduleLookupError } = await supabase
    .from('schedules')
    .select('id')
    .eq('id', idem.scheduleId)
    .eq('user_id', userId)
    .maybeSingle();
  // Fail closed: a blind schedule lookup must never lead to a second charge.
  if (scheduleLookupError) {
    logger.error('[generate-and-schedule] idempotency schedule lookup failed', scheduleLookupError, {
      scheduleId: idem.scheduleId,
      userId,
    });
    return coded(500, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
  }
  if (existingSchedule) {
    // A schedule with zero slots is a zombie from an attempt that died
    // between the schedule insert and the slot insert (crash, timeout): it
    // can never produce videos, so for replay purposes it is treated as
    // non-existent at ANY age — delete it and run the operation fresh. This
    // is safe because no live request can be stalled "between" the two
    // inserts: only the synchronous trackApiEvent call sits there, with no
    // await, so a 0-slot row is never being worked on. (An age TTL here
    // used to let a fresh zombie get replayed empty: "0 publish slot(s)".)
    // The ledger check below prevents a second charge for the same
    // generation_id.
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
      const replayed = await fetchReplay(supabase, userId, idem.scheduleId, voiceFallbackWarning);
      if (replayed) return replayed;
    }
  }
  // Read-your-ledger, net-based: the generation counts as already spent only
  // while its spends exceed its refunds (see netLedgerSpent in lib/tokens).
  const { data: ledgerRows, error: ledgerError } = await supabase
    .from('token_transactions')
    .select('type, amount')
    .eq('generation_id', idem.generationId);
  // Fail closed: charging blind after a failed ledger read risks a double spend.
  if (ledgerError) {
    logger.error('[generate-and-schedule] spend ledger lookup failed', ledgerError, {
      generationId: idem.generationId,
      userId,
    });
    return coded(500, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
  }
  const alreadySpent = netLedgerSpent(ledgerRows ?? []) > 0;
  if (alreadySpent) {
    logger.warn('[generate-and-schedule] spend ledger already has this generation_id; resuming without charging', {
      generationId: idem.generationId,
      userId,
    });
  }

  // 8. ONE atomic spend for the whole operation. Never partial.
  if (!alreadySpent) {
    // Lazy one-time signup bonus, same best-effort grant as other flows.
    try {
      await supabase.rpc('grant_signup_bonus', { p_user_id: userId });
    } catch {
      // Best-effort: the spend below is the real gate.
    }
    const { data: spendData, error: spendError } = await supabase.rpc('spend_tokens', {
      p_user_id: userId,
      p_amount: perVideoCost,
      p_generation_id: idem.generationId,
      p_reason: 'Unified generate+schedule (1 video)',
    });
    if (spendError) {
      if (violatedConstraint(spendError) !== null) {
        // A concurrent duplicate spent under the same generation_id first:
        // replay instead of double-charging.
        const replayed = await fetchReplay(supabase, userId, idem.scheduleId, voiceFallbackWarning);
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

  // Persist a voice swap only after a successful spend (or a ledger hit
  // that already charged): a 402 / failed lookup must not rewrite
  // personas.voice_id. Slot dispatch still sees the swapped id on prep.
  if (prep.voiceFallback !== undefined && personaId !== null) {
    await persistVoiceSwap(supabase, userId, personaId, prep.voiceFallback);
  }

  // 9. Insert the schedule. The id is deterministic (idempotency anchor).
  // scheduled_at stays NULL during dispatch, so the engine's immediate
  // one-off path cannot race us and double-generate.
  // NOTE: do not add keys here that are not columns on public.schedules —
  // PostgREST rejects the whole insert on an unknown key (every call 500s).
  const sortedTimes = [...new Set(times.map((t) => t.trim()))].sort();
  const { error: scheduleError } = await supabase.from('schedules').insert({
    id: idem.scheduleId,
    user_id: userId,
    // NULL for a post created without one (migration 012).
    persona_id: personaId,
    providers,
    ...scheduleAccountColumns(accountIds), pinterest_board_id: pinterestBoardId,
    days_of_week: null, start_hour: null, end_hour: null,
    posts_per_day: 1,
    times: sortedTimes,
    timezone,
    scheduled_at: null,
    active: true,
    // Publish mode (migration 015): 'scheduled' publishes at the slot
    // times, 'asap' publishes each video the moment generation finishes.
    publish_mode: mode,
    // Identity snapshot (migration 012). The engine reads these at tick time
    // through post_identity, and they are the values this request was priced
    // with — writing them here is what makes a scheduled post reproducible
    // when the persona is edited (or deleted) afterwards.
    post_voice_id: prep.voiceIdValue ?? null,
    // Snapshot the RAW request audioUrl, not the resolved voiceAudioUrl: for
    // a persona-backed post that is a 1-hour signed URL of the persona's
    // voice_audio_path, and snapshotting it would store an expired URL that
    // shadows the fresh re-signing at tick time. The raw URL is only ever a
    // stable remote URL (validated + SSRF-checked above).
    post_voice_audio_url: validatedOptions.audioUrl ?? null,
    post_cta_text: prep.ctaText,
    post_niche: prep.niche,
    post_language: prep.language,
    post_video_aspect: prep.videoAspect,
    post_video_layout: prep.videoLayout,
    post_paragraph_number: prep.paragraphNumber,
    post_face_quality: prep.faceQuality,
  });
  if (scheduleError) {
    const constraint = violatedConstraint(scheduleError);
    if (constraint === SCHEDULES_PERSONA_OWNER_CONSTRAINT) {
      // The persona already owns a schedule row and this database still
      // enforces one-schedule-per-persona (migration 011 has not been applied
      // here). Nothing was inserted under our schedule id, so there is no
      // winner to replay: answering `{slots: [], replayed: true}` would tell
      // the caller a batch of videos is scheduled when not a single one is.
      // Our own spend is redundant either way — refund it, then report the
      // conflict honestly. When the spend was skipped (alreadySpent) there is
      // nothing of ours to undo, and refunding would steal the prior spend.
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
      // Lost a PK race with a concurrent duplicate (or a replay slipped past
      // the pre-check) on schedules_pkey. If we spent in this request, our
      // spend is redundant: the winner's own spend under the same
      // generation_id is the single charge, so undo ours. Without this, the
      // missing unique constraint on token_transactions.generation_id lets
      // both spends stand.
      // When we skipped our spend (alreadySpent), there is nothing of ours
      // to undo — refunding would steal the legitimate prior spend.
      if (!alreadySpent) {
        const refunded = await refundRollbackSpend(supabase, {
          userId,
          generationId: idem.generationId,
          amount: perVideoCost,
          reason: 'PK race; refunded redundant spend',
          failureLog: '[generate-and-schedule] PK race refund failed; replaying winner anyway',
        });
        // The winner's schedule exists regardless of whether our refund
        // landed: still replay it below. A failed refund is a billing
        // discrepancy, not a request failure — the helper logs it loudly
        // for investigation instead of letting the log claim success.
        if (refunded) {
          logger.error('[generate-and-schedule] schedule PK race; refunded redundant spend, replaying winner', scheduleError, {
            scheduleId: idem.scheduleId,
            userId,
            constraint,
          });
        }
      } else {
        logger.error('[generate-and-schedule] schedule PK race; already spent, nothing to refund, replaying winner', scheduleError, {
          scheduleId: idem.scheduleId,
          userId,
          constraint,
        });
      }
      trackApiEvent('video_creation_failed', {
        userId,
        scheduleId: idem.scheduleId,
        errorCode: 'IDEMPOTENCY_CONFLICT',
        failureStage: 'schedule_insert_race',
      });
      const replayed = await fetchReplay(supabase, userId, idem.scheduleId, voiceFallbackWarning);
      if (replayed) return replayed;
    }
    // Real DB failure after the spend: refund the whole generation loudly.
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

  // 10. Insert the slot (pending); see slot-rows.ts for the row shape.
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
    // Compensating rollback: nothing may survive half-created. Loud logs;
    // the refund makes the user whole.
    logger.error('[generate-and-schedule] slot insert failed; rolling back schedule', slotsError, {
      scheduleId: idem.scheduleId,
      userId,
    });
    await supabase.from('scheduled_posts').delete().eq('schedule_id', idem.scheduleId).eq('user_id', userId);
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
    // Race guard: the partner may have committed since the pre-charge check.
    const recheck = await verifyExperimentPairAfterInsert(supabase, { link: experiment, userId, facts: pairFacts });
    if (!recheck.ok) {
      logger.error('[generate-and-schedule] experiment pair re-check failed after insert; rolling back', undefined, { scheduleId: idem.scheduleId, userId, field: recheck.field });
      await supabase.from('scheduled_posts').delete().eq('schedule_id', idem.scheduleId).eq('user_id', userId);
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

  // 11. Dispatch the one engine generation and bind the task_id.
  // A failed slot is an explicit terminal state (failed + refunded), never
  // an orphan.
  const results: SlotResult[] = [];
  let accepted = 0;
  let failed = 0;
  const recentIds: string[] = [];
  for (let i = 0; i < slotRows.length; i += 1) {
    const slot = slotRows[i] as { id: string; slot_at: string; title: string };
    const slotGenerationId = `${idem.generationId}:slot:${slot.id}`;
    try {
      // Photo for this video: pinned override or library selection matched
      // to its title (faceless skips the face entirely).
      let photoUrl: string | undefined;
      let pickedImageId: string | null = null;
      if (validatedOptions.videoType !== 'faceless' && personaId !== null) {
        const selection = await resolveVideoImage(supabase, personaId, userId, recentIds, {
          title,
          niche: prep.niche,
          // Image keyword matching uses the actual segments script now, not
          // the removed prompt: the prompt was only ever a proxy for it.
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
          // A house character is stored as a relative path to our own static
          // asset. The engine fetches the image over HTTP behind an SSRF guard
          // that rejects loopback, so a relative path — and even an origin-
          // prefixed one in local dev — cannot be downloaded. Re-host it in
          // the personas bucket first.
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
        cta_text: prep.ctaText,
        paragraph_number: prep.paragraphNumber,
        niche: prep.niche,
        face_quality: prep.faceQuality,
      };
      const payload = buildJobPayload(jobPersona, {
        video_title: title, video_description: description,
        video_type: validatedOptions.videoType,
        video_script: segmentsScript,
        webhook_url: validatedOptions.webhookUrl,
        // generation_id: web-side correlation id for PostHog event joins;
        // slot_id: lets boot orphan triage requeue (not fail) on engine restart.
        generation_id: slotGenerationId,
        slot_id: slot.id,
        music_mood: validatedOptions.musicMood,
        segments: options?.segments, // Segment media rides to the engine here, next to the joined script.
      });
      if (!hasNonEmptyString(payload.video_title)) {
        throw new SlotDispatchError('empty_title', 'Video title is empty.');
      }

      // History snapshot (+ full engine payload for the boot rebuild, #205).
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

      // Slot -> generating WITH the task_id in one update: the invariant
      // "no slot without a task" holds from this write on.
      const { error: bindError } = await supabase
        .from('scheduled_posts')
        .update({ status: 'generating', task_id: engineTask.taskId })
        .eq('id', slot.id)
        .eq('user_id', userId);
      if (bindError) {
        // The engine accepted the task but the bind failed: preserve the
        // taskId for recovery instead of orphaning it.
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
      // Anti-repeat history is committed only after the engine accepts the
      // job: a failed (refunded) dispatch must not burn a rotation slot.
      // pickedImageId is only ever set on the persona branch above.
      if (pickedImageId && personaId !== null) {
        await recordRecentImageId(supabase, personaId, pickedImageId, userId);
        recentIds.push(pickedImageId);
      }

      results.push({ slotId: slot.id, slotAt: slot.slot_at, title, taskId: engineTask.taskId, status: 'generating' });
      accepted += 1;
    } catch (error) {
      const dispatchError = error instanceof SlotDispatchError ? error : new SlotDispatchError('slot_failed', 'Video generation failed for this slot.');
      // Explicit terminal state + per-slot refund of this video's prepaid
      // cost (the engine's batch refund convention). Siblings continue.
      await supabase.from('scheduled_posts').update({ status: 'failed' }).eq('id', slot.id).eq('user_id', userId);
      const { error: refundError } = await supabase.rpc('refund_batch_tokens', {
        p_user_id: userId,
        p_batch_generation_id: idem.generationId,
        p_refund_key: `${idem.generationId}:slot:${slot.id}`,
        p_amount: perVideoCost,
        p_reason: 'Unified generate+schedule: slot dispatch failed; video refunded',
      });
      const refunded = !refundError;
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
      results.push({ slotId: slot.id, slotAt: slot.slot_at, title, taskId: null, status: 'failed', errorCode: dispatchError.errorCode });
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
    ...(voiceFallbackWarning !== null ? { warnings: [voiceFallbackWarning] } : {}),
  };
  if (failed > 0 && accepted === 0) {
    // Every video failed (each already refunded): report the operation as
    // failed, keeping the per-slot detail so callers can see what happened.
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

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
// The user id is resolved lazily, only when a 5xx is actually reported.
//---------------
export const POST = withApiErrorReporting(ROUTE, postHandler, { getUserId: resolveReportingUserId });
