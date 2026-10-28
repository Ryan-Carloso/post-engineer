//---------------
// POST /api/videos/generate-and-schedule — the single generate+schedule operation.
//
// Product rule: a video and its publishing schedule are always born together.
// One request carries 1–10 topics, a persona, publishing destinations and a
// publish-time plan. The API validates everything, charges the total token
// cost atomically, creates the schedule + slots, dispatches one engine
// generation per slot and binds each task_id to its slot.
//
// Backend flow: validate input -> auth -> rate limit -> persona scope +
// ownership -> providers + accounts -> distribute slots -> window check
// -> cost -> idempotency pre-checks -> ONE atomic spend_tokens -> insert
// schedule -> insert slots -> dispatch engine tasks per slot.
//---------------

import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { isPersonaAllowed } from '@/lib/api-keys';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { isEnglishLanguage, ONLY_ENGLISH_VIDEOS_MESSAGE } from '@/lib/language-gate';
import {
  distributeSlots,
  SlotDistributionError,
  type DistributedSlot,
} from '@/lib/schedule/slot-distribution';
import { validateScheduleWindow } from '@/lib/schedule-window';
import { isValidTimezone } from '@/lib/timezone';
import { computeVideoTokens, toFiniteNumber } from '@/lib/tokens';
import { resolvePublishingAccounts, signedUrl } from './persona-prep';
import { validateTopics } from './topics-validation';
import { validateSegmentsRequest } from './segments-validation';
import {
  MAX_TOPIC_CHARS,
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
import {
  recordGenerationStart,
  recordGenerationUpdate,
  startEngineVideoTask,
} from '@/lib/generation/video-generation';
import { checkCustomAudioUrl, isHttpUrl } from '@/lib/generation/custom-audio';
import { recordRecentImageId, resolveVideoImage } from '@/lib/persona-images';
import { resolveIdempotency } from '@/lib/idempotency';
import { VALID_SCHEDULE_PROVIDERS } from '@/app/api/schedule/route';
import { trackApiEvent } from '@/lib/analytics';
import { logger } from '@/lib/logger';
import { VOICE_FALLBACK_WARNING_CODE } from '@/lib/voice-fallback';
import { ensureEngineImageUrl } from '@/lib/engine-image-url';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

// Shared with the /posts/new form so the UI cap and the API cap can't drift.
const ROUTE = 'POST /api/videos/generate-and-schedule';
const MAX_SCRIPT_PROMPT_CHARS = 2000;
// Mirrors the engine's PersonaParams caps (apps/engine/app/models/schema.py):
// rejecting at the same boundary here is what turns an opaque engine
// validation error into a 400 that names the field.
const MAX_LANGUAGE_CHARS = 32;

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
  providers: z.array(z.string()),
  accounts: z.record(z.string(), z.array(z.string())).optional(),
  // Required in scheduled mode, forbidden in asap mode (a stray plan would
  // be silently ignored, so it is a 400 instead).
  schedule: PublishingScheduleSchema.optional(),
  // ASAP-only: the user's IANA zone, kept for display. Optional because the
  // schedules.timezone column is NOT NULL DEFAULT 'UTC'.
  timezone: z.string().optional(),
});

const OptionsSchema = z
  .object({
    faceless: z.boolean().optional(),
    facelessMaterial: z.enum(['broll', 'svg']).optional(),
    audioUrl: z.string().optional(),
    imageId: z.string().optional(),
    scriptPrompt: z.string().optional(),
    scriptPrompts: z.array(z.string()).optional(),
    // Segments contract (MCP first, Phase 1): one call = one video. The
    // joined script becomes the video script; no LLM expands it. The
    // engine's existing persona script budget and duration trim still
    // apply to persona videos downstream.
    segments: z
      .array(
        z
          .object({
            kind: z.enum(['hook', 'body', 'cta']),
            text: z.string(),
            media: z
              .object({ mediaId: z.string().optional(), url: z.string().optional() })
              .strict()
              .optional(),
            terms: z.array(z.string()).optional(),
          })
          .strict(),
      )
      .optional(),
    webhookUrl: z.string().optional(),
    voiceId: z.string().optional(),
    // The rest of a persona's editorial definition, for a post created
    // WITHOUT one (migration 012). With a persona these still override it.
    videoAspect: z.enum(['9:16', '16:9']).optional(),
    videoLayout: z.enum(['standard', 'react']).optional(),
    paragraphNumber: z.number().int().min(1).max(10).optional(),
    language: z.string().optional(),
    niche: z.string().optional(),
  })
  .optional();

const BodySchema = z.object({
  // Optional: a faceless post can be defined entirely by options + topic.
  personaId: z.string().optional(),
  topics: z.array(z.string()),
  publishing: PublishingSchema,
  options: OptionsSchema,
  idempotencyKey: z.string().optional(),
});

type ParsedBody = z.infer<typeof BodySchema>;
type Provider = (typeof VALID_SCHEDULE_PROVIDERS)[number];

interface SlotResult {
  slotId: string;
  slotAt: string;
  topic: string;
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

interface ValidatedInput {
  /** Null for a post created without a persona (migration 012). */
  personaId: string | null;
  topics: string[];
  providers: Provider[];
  accountIds: Record<Provider, string[]>;
  startAt: string;
  times: string[];
  timezone: string;
  faceless: boolean;
  /** Resolved in validateOptions: 'broll' when omitted. Applies to every
   *  post, with or without a face (stock only, or illustrations only). */
  facelessMaterial: 'broll' | 'svg';
  audioUrl?: string;
  imageId?: string;
  scriptPrompt?: string;
  scriptPrompts?: string[];
  webhookUrl?: string;
  voiceId?: string;
  videoAspect?: '9:16' | '16:9';
  /** 'standard' = the avatar fills the frame; 'react' = the frame splits,
   *  avatar on top and the video material below. Absent means standard. */
  videoLayout?: 'standard' | 'react';
  paragraphNumber?: number;
  language?: string;
  niche?: string;
}

function validateProviders(rawProviders: string[]): Provider[] | NextResponse {
  const providers = [...new Set(rawProviders.map((p) => p.trim()).filter((p) => p.length > 0))];
  if (providers.length === 0) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'Select at least one provider.', 'publishing.providers');
  }
  for (const provider of providers) {
    if (!(VALID_SCHEDULE_PROVIDERS as ReadonlyArray<string>).includes(provider)) {
      return validationFailed(
        ERROR_CODES.VALIDATION_FAILED,
        `Invalid provider: "${provider}". Use one of ${VALID_SCHEDULE_PROVIDERS.join(', ')}.`,
        'publishing.providers',
      );
    }
  }
  return providers as Provider[];
}

function validateOptions(
  options: NonNullable<ParsedBody['options']>,
  topicCount: number,
): Omit<ValidatedInput, 'personaId' | 'topics' | 'providers' | 'accountIds' | 'startAt' | 'times' | 'timezone'> | NextResponse {
  const {
    faceless = false,
    facelessMaterial,
    audioUrl,
    imageId,
    scriptPrompt,
    scriptPrompts,
    webhookUrl,
    voiceId,
    videoAspect,
    paragraphNumber,
    language,
    niche,
  } = options;
  if (typeof faceless !== 'boolean') {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'options.faceless must be a boolean.', 'options.faceless');
  }
  if (audioUrl !== undefined && !isHttpUrl(audioUrl)) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'options.audioUrl must be a valid http(s) URL.', 'options.audioUrl');
  }
  if (imageId !== undefined && imageId.trim().length === 0) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'options.imageId must be a non-empty string.', 'options.imageId');
  }
  if (faceless && imageId !== undefined) {
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      'options.imageId cannot be used with faceless videos: there is no face to render.',
      'options.imageId',
    );
  }
  if (webhookUrl !== undefined && !isHttpUrl(webhookUrl)) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'options.webhookUrl must be a valid http(s) URL.', 'options.webhookUrl');
  }
  if (voiceId !== undefined && voiceId.trim().length === 0) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'options.voiceId must be a non-empty string.', 'options.voiceId');
  }
  // Caps mirroring the persona's own validation, so a persona-less post is
  // rejected with the persona editor's message, not an opaque engine error.
  if (language !== undefined && language.length > MAX_LANGUAGE_CHARS) {
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      `options.language must be at most ${MAX_LANGUAGE_CHARS} characters.`,
      'options.language',
    );
  }
  // English-only launch: a video in any other language is rejected here
  // (and again on the effective language in preparePersona).
  if (language !== undefined && language.trim().length > 0 && !isEnglishLanguage(language)) {
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      ONLY_ENGLISH_VIDEOS_MESSAGE,
      'options.language',
    );
  }
  if (niche !== undefined && niche.length > MAX_TOPIC_CHARS) {
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      `options.niche must be at most ${MAX_TOPIC_CHARS} characters.`,
      'options.niche',
    );
  }
  if (scriptPrompt !== undefined && scriptPrompt.length > MAX_SCRIPT_PROMPT_CHARS) {
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      `options.scriptPrompt must be at most ${MAX_SCRIPT_PROMPT_CHARS} characters.`,
      'options.scriptPrompt',
    );
  }
  if (scriptPrompts !== undefined) {
    if (scriptPrompts.length !== topicCount) {
      return validationFailed(
        ERROR_CODES.VALIDATION_FAILED,
        `options.scriptPrompts must have one entry per topic (${topicCount}).`,
        'options.scriptPrompts',
      );
    }
    for (let i = 0; i < scriptPrompts.length; i += 1) {
      if (scriptPrompts[i].length > MAX_SCRIPT_PROMPT_CHARS) {
        return validationFailed(
          ERROR_CODES.VALIDATION_FAILED,
          `options.scriptPrompts[${i}] must be at most ${MAX_SCRIPT_PROMPT_CHARS} characters.`,
          `options.scriptPrompts.${i}`,
        );
      }
    }
  }
  return {
    faceless,
    facelessMaterial: facelessMaterial ?? 'broll',
    audioUrl,
    imageId: imageId?.trim(),
    scriptPrompt,
    scriptPrompts,
    webhookUrl,
    voiceId: voiceId?.trim(),
    videoAspect,
    paragraphNumber,
    language,
    niche,
  };
}

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
              : 'topics';
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
  topicCount: number,
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
    const slots: DistributedSlot[] = Array.from({ length: topicCount }, (_, i) => ({
      slotAtISO: now.toISOString(),
      dayIndex: 0,
      timeIndex: i,
    }));
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
  const slots = validateSlots(schedule.startAt, schedule.times, schedule.timezone, topicCount);
  if (slots instanceof NextResponse) return slots;
  return {
    mode,
    slots,
    times: schedule.times,
    timezone: schedule.timezone,
  };
}

//---------------
// Social account validation. One query loads all of the user's accounts;
// each requested id must belong to the user AND to the requested provider,
// distinguishing "not yours" from "yours but for another provider".
//---------------
async function validateAccounts(
  supabase: SupabaseClient,
  userId: string,
  providers: Provider[],
  accounts: Record<string, string[] | undefined>,
): Promise<Record<Provider, string[]> | NextResponse> {
  const { data: rows, error } = await supabase
    .from('social_accounts')
    .select('provider, provider_account_id')
    .eq('user_id', userId);
  if (error) {
    logger.error('[generate-and-schedule] social accounts lookup failed', error, { userId });
    return coded(500, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
  }
  const byProvider = new Map<string, Set<string>>();
  const providerOfId = new Map<string, string>();
  for (const row of rows ?? []) {
    const provider = (row as { provider: string }).provider;
    const accountId = (row as { provider_account_id: string }).provider_account_id;
    if (typeof provider !== 'string' || typeof accountId !== 'string') continue;
    if (!byProvider.has(provider)) byProvider.set(provider, new Set());
    byProvider.get(provider)?.add(accountId);
    providerOfId.set(accountId, provider);
  }

  const accountIds = {} as Record<Provider, string[]>;
  for (const provider of providers) {
    const field = `publishing.accounts.${provider}`;
    const ids = [...new Set((accounts[provider] ?? []).map((id) => id.trim()).filter((id) => id.length > 0))];
    accountIds[provider] = ids;
    if (ids.length === 0) {
      const connected = byProvider.get(provider);
      if (!connected || connected.size === 0) {
        return validationFailed(
          ERROR_CODES.NO_CONNECTED_ACCOUNTS,
          formatErrorMessage(ERROR_CODES.NO_CONNECTED_ACCOUNTS, { provider }),
          field,
        );
      }
      return validationFailed(
        ERROR_CODES.INVALID_PROVIDER_ACCOUNT,
        `Select at least one ${provider} account to publish to.`,
        field,
      );
    }
    for (const id of ids) {
      if (byProvider.get(provider)?.has(id)) continue;
      const actualProvider = providerOfId.get(id);
      if (actualProvider) {
        return validationFailed(
          ERROR_CODES.INVALID_PROVIDER_ACCOUNT,
          `Selected account cannot be used with ${provider}.`,
          field,
        );
      }
      return validationFailed(
        ERROR_CODES.SOCIAL_ACCOUNT_NOT_OWNED,
        formatErrorMessage(ERROR_CODES.SOCIAL_ACCOUNT_NOT_OWNED, { provider }),
        field,
      );
    }
  }
  return accountIds;
}


//---------------
// Replay helper: fetch an existing schedule + slots for an idempotent retry.
//---------------
async function fetchReplay(
  supabase: SupabaseClient,
  userId: string,
  scheduleId: string,
  voiceFallbackWarning: { code: string; fromVoice: string; toVoice: string } | null = null,
): Promise<NextResponse | null> {
  const { data: slots, error } = await supabase
    .from('scheduled_posts')
    .select('id, slot_at, topic, task_id, status')
    .eq('schedule_id', scheduleId)
    .eq('user_id', userId)
    .order('slot_at', { ascending: true });
  if (error || !slots) {
    logger.error('[generate-and-schedule] replay fetch failed', error, { scheduleId });
    return null;
  }
  // Replay ASAP uses the stored publish_mode; pre-015 rows default scheduled.
  const { data: scheduleRow } = await supabase
    .from('schedules')
    .select('publish_mode')
    .eq('id', scheduleId)
    .eq('user_id', userId)
    .maybeSingle();
  const mode =
    (scheduleRow as { publish_mode?: unknown } | null)?.publish_mode === 'asap' ? 'asap' : 'scheduled';
  return NextResponse.json({
    success: true,
    schedule: { id: scheduleId, mode },
    slots: slots.map((row) => ({
      slotId: (row as { id: string }).id,
      slotAt: (row as { slot_at: string }).slot_at,
      topic: (row as { topic: string }).topic,
      taskId: (row as { task_id: string | null }).task_id,
      status: (row as { status: string }).status,
    })),
    replayed: true,
    ...(voiceFallbackWarning !== null ? { warnings: [voiceFallbackWarning] } : {}),
  });
}

async function postHandler(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();

  // 1. Validate input shape + semantics (no DB, no charge).
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'Invalid JSON payload.');
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue.path.length > 0 ? issue.path.join('.') : undefined;
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, `Invalid request: ${issue.message}`, field);
  }
  const { publishing, options, idempotencyKey } = parsed.data;

  // A blank/absent personaId means "post without a persona" (migration 012).
  // Null is the only accepted spelling so a caller cannot half-intend a
  // persona by sending an empty string.
  const personaId = parsed.data.personaId?.trim() || null;
  const topics = validateTopics(parsed.data.topics);
  if (topics instanceof NextResponse) return topics;
  // Segments validation runs here, before auth and before any charge.
  const segmentsScript = validateSegmentsRequest(options?.segments, topics.length);
  if (segmentsScript instanceof NextResponse) return segmentsScript;
  const providers = validateProviders(publishing.providers);
  if (providers instanceof NextResponse) return providers;
  const validatedOptions = validateOptions(options ?? {}, topics.length);
  if (validatedOptions instanceof NextResponse) return validatedOptions;

  // A post without a persona has no face to render and no voice to speak
  // with: the engine's PersonaParams requires exactly one voice. Both are
  // refused here, before auth and before any charge.
  if (personaId === null) {
    if (!validatedOptions.faceless) {
      return validationFailed(
        ERROR_CODES.VALIDATION_FAILED,
        'A post without a persona must be faceless: set options.faceless to true.',
        'options.faceless',
      );
    }
    if (validatedOptions.voiceId === undefined && validatedOptions.audioUrl === undefined) {
      return validationFailed(
        ERROR_CODES.VALIDATION_FAILED,
        'A post without a persona needs a voice: set options.voiceId (or options.audioUrl).',
        'options.voiceId',
      );
    }
  }

  // Publish mode: scheduled (default) distributes slots across the plan's
  // times; asap skips the schedule entirely and lands every slot at the
  // request time, so the engine's tick publishes each video the moment its
  // generation finishes.
  const plan = validatePublishMode(publishing, topics.length, new Date());
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

  // 3. Rate limit: one call can mint up to 10 videos, so the profile is
  // lower than the single video-job one, keyed by user id.
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
    numberOfVideos: topics.length,
    providers,
    faceless: validatedOptions.faceless,
  });

  // 4. Persona scope (API keys) + ownership. A persona-less post has nothing
  // to scope against, so the scope check only applies when one is named.
  if (personaId !== null && !isPersonaAllowed(auth.personaIds, personaId)) {
    return validationFailed(ERROR_CODES.PERSONA_SCOPE_DENIED, formatErrorMessage(ERROR_CODES.PERSONA_SCOPE_DENIED), 'personaId', 403);
  }
  const prep = await preparePost(supabase, userId, personaId, {
    faceless: validatedOptions.faceless,
    audioUrl: validatedOptions.audioUrl,
    imageId: validatedOptions.imageId,
    voiceId: validatedOptions.voiceId,
    scriptPrompt: validatedOptions.scriptPrompt,
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
  const accountIds = await validateAccounts(supabase, userId, providers, await resolvePublishingAccounts(supabase, personaId, publishing.accounts));
  if (accountIds instanceof NextResponse) return accountIds;

  // Pinned library image: fail fast when the id does not resolve, before
  // any charge. Per-topic resolution still happens at dispatch time.
  const requestedImageId =
    personaId !== null ? (validatedOptions.imageId?.trim() || null) : null;
  if (requestedImageId && personaId !== null) {
    const imageCheck = await resolveVideoImage(supabase, personaId, userId, [], {
      topic: topics[0],
      niche: prep.niche,
      script: prep.scriptPrompt,
      imageId: requestedImageId,
    });
    if (!imageCheck.ok) {
      return validationFailed(ERROR_CODES.VALIDATION_FAILED, imageCheck.error, 'options.imageId', imageCheck.status);
    }
  }

  // 6. Cost for the whole operation, computed BEFORE the charge.
  const perVideoCost = computeVideoTokens(prep.faceless, prep.faceQuality);
  const totalCost = perVideoCost * topics.length;
  trackApiEvent('video_creation_validated', {
    userId,
    personaId,
    numberOfVideos: topics.length,
    providers,
    faceless: validatedOptions.faceless,
  });
  trackApiEvent('video_tokens_calculated', {
    userId,
    personaId,
    numberOfVideos: topics.length,
    perVideoCost,
    tokenCost: totalCost,
  });

  // 7. Idempotency: the schedule id is deterministic in (user, key), so a
  // retry addresses the same schedule row instead of creating a duplicate.
  // A 0-slot row is a zombie and is deleted below so the operation runs
  // fresh instead of being replayed empty.
  const idem = resolveIdempotency(userId, idempotencyKey, request);
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
  // Read-your-ledger: a previous attempt may have spent but died before the
  // schedule insert (no unique constraint on generation_id is assumed).
  // Residual race vs a concurrent duplicate is documented below at insert.
  const { data: ledgerRows, error: ledgerError } = await supabase
    .from('token_transactions')
    .select('id')
    .eq('generation_id', idem.generationId)
    .limit(1);
  // Fail closed: charging blind after a failed ledger read risks a double spend.
  if (ledgerError) {
    logger.error('[generate-and-schedule] spend ledger lookup failed', ledgerError, {
      generationId: idem.generationId,
      userId,
    });
    return coded(500, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
  }
  const alreadySpent = (ledgerRows?.length ?? 0) > 0;
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
      p_amount: totalCost,
      p_generation_id: idem.generationId,
      p_reason: `Unified generate+schedule (${topics.length} videos)`,
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
        tokenCost: totalCost,
      });
      return coded(402, ERROR_CODES.INSUFFICIENT_TOKENS, formatErrorMessage(ERROR_CODES.INSUFFICIENT_TOKENS, { need: totalCost, have }), undefined, {
        have,
        need: totalCost,
      });
    }
  }
  trackApiEvent('video_tokens_spent', {
    userId,
    personaId,
    numberOfVideos: topics.length,
    tokenCost: totalCost,
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
    youtube_account_ids: accountIds.youtube ?? [],
    instagram_account_ids: accountIds.instagram ?? [],
    linkedin_account_ids: accountIds.linkedin ?? [],
    bluesky_account_ids: accountIds.bluesky ?? [],
    days_of_week: null,
    start_hour: null,
    end_hour: null,
    posts_per_day: topics.length,
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
    post_script_prompt: prep.scriptPrompt,
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
        const { error: refundError } = await supabase.rpc('refund_generation_tokens', {
          p_user_id: userId,
          p_generation_id: idem.generationId,
          p_reason: 'Persona already scheduled; refunded redundant spend',
        });
        if (refundError) {
          logger.error('[generate-and-schedule] persona-already-scheduled refund failed', refundError, {
            scheduleId: idem.scheduleId,
            userId,
            generationId: idem.generationId,
          });
        }
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
        const { error: refundError } = await supabase.rpc('refund_generation_tokens', {
          p_user_id: userId,
          p_generation_id: idem.generationId,
          p_reason: 'PK race; refunded redundant spend',
        });
        if (refundError) {
          // The winner's schedule exists regardless of whether our refund
          // landed: still replay it below. A failed refund is a billing
          // discrepancy, not a request failure — log it loudly for
          // investigation instead of letting the log claim success.
          logger.error('[generate-and-schedule] PK race refund failed; replaying winner anyway', refundError, {
            scheduleId: idem.scheduleId,
            userId,
            generationId: idem.generationId,
          });
        } else {
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
    const { error: refundError } = await supabase.rpc('refund_generation_tokens', {
      p_user_id: userId,
      p_generation_id: idem.generationId,
      p_reason: 'Unified generate+schedule: schedule insert failed; tokens refunded',
    });
    if (refundError) {
      logger.error('[generate-and-schedule] refund after schedule insert failure failed', refundError, {
        scheduleId: idem.scheduleId,
        userId,
        generationId: idem.generationId,
      });
    }
    trackApiEvent('video_creation_failed', { userId, errorCode: ERROR_CODES.INTERNAL_ERROR, failureStage: 'schedule_insert' });
    return coded(500, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
  }
  trackApiEvent('video_schedule_created', {
    userId,
    personaId,
    scheduleId: idem.scheduleId,
    numberOfVideos: topics.length,
    providers,
    publishMode: mode,
  });

  // 10. Insert the slots (pending). The id is database-generated; the
  // returned rows carry it for the per-slot dispatch below.
  // `faceless` is stored ON the slot, not derived from the persona at read
  // time: it is a per-post choice, and the engine's batch pipeline reads it
  // from this row when it prices a slot's failure refund.
  const { data: slotRows, error: slotsError } = await supabase
    .from('scheduled_posts')
    .insert(
      slots.map((slot, i) => ({
        schedule_id: idem.scheduleId,
        user_id: userId,
        slot_at: slot.slotAtISO,
        status: 'pending',
        topic: topics[i],
        faceless: prep.faceless,
        faceless_material: validatedOptions.facelessMaterial,
        segments: options?.segments ?? null,
      })),
    )
    .select('id, slot_at, topic');
  if (slotsError || !slotRows || slotRows.length !== topics.length) {
    // Compensating rollback: nothing may survive half-created. Loud logs;
    // the refund makes the user whole.
    logger.error('[generate-and-schedule] slot insert failed; rolling back schedule', slotsError, {
      scheduleId: idem.scheduleId,
      userId,
    });
    await supabase.from('scheduled_posts').delete().eq('schedule_id', idem.scheduleId).eq('user_id', userId);
    await supabase.from('schedules').delete().eq('id', idem.scheduleId).eq('user_id', userId);
    await supabase.rpc('refund_generation_tokens', {
      p_user_id: userId,
      p_generation_id: idem.generationId,
      p_reason: 'Unified generate+schedule: slot insert failed; tokens refunded',
    });
    trackApiEvent('video_creation_failed', { userId, scheduleId: idem.scheduleId, errorCode: ERROR_CODES.INTERNAL_ERROR, failureStage: 'slot_insert' });
    return coded(500, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
  }
  trackApiEvent('video_slots_created', { userId, scheduleId: idem.scheduleId, numberOfVideos: topics.length });

  // 11. Dispatch one engine generation per slot and bind the task_id.
  // A failed slot is an explicit terminal state (failed + refunded), never
  // an orphan; remaining slots still dispatch.
  const results: SlotResult[] = [];
  let accepted = 0;
  let failed = 0;
  const recentIds: string[] = [];
  for (let i = 0; i < slotRows.length; i += 1) {
    const slot = slotRows[i] as { id: string; slot_at: string; topic: string };
    const topic = topics[i];
    const slotGenerationId = `${idem.generationId}:slot:${slot.id}`;
    try {
      // Per-topic photo: pinned override or library selection matched to
      // this topic (faceless skips the face entirely).
      let photoUrl: string | undefined;
      let pickedImageId: string | null = null;
      if (!validatedOptions.faceless && personaId !== null) {
        const selection = await resolveVideoImage(supabase, personaId, userId, recentIds, {
          topic,
          niche: prep.niche,
          script: prep.scriptPrompt,
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
        script_prompt: prep.scriptPrompt,
        cta_text: prep.ctaText,
        paragraph_number: prep.paragraphNumber,
        niche: prep.niche,
        face_quality: prep.faceQuality,
      };
      const payload = buildJobPayload(jobPersona, {
        video_subject: topic,
        video_script: segmentsScript,
        video_script_prompt: validatedOptions.scriptPrompts?.[i] ?? validatedOptions.scriptPrompt,
        webhook_url: validatedOptions.webhookUrl,
        // generation_id/slot_id: PostHog correlation id; slot_id lets boot orphan triage requeue on restart.
        generation_id: slotGenerationId,
        segments: options?.segments, // Segment media rides to the engine here, next to the joined script.
        slot_id: slot.id,
        // The per-post "no face" choice reaches the engine as lipsync: the
        // engine's persona_lipsync_active also returns false when no visual is
        // attached, and a faceless job carries no photo_url.
        lipsync: !prep.faceless,
        // The material choice rides the payload under its snake_case name on every post, face or not.
        faceless_material: validatedOptions.facelessMaterial,
      });
      if (!hasNonEmptyString(payload.video_subject)) {
        throw new SlotDispatchError('empty_subject', 'Video subject is empty.');
      }

      // History snapshot (+ full engine payload for the boot rebuild, #205).
      await recordGenerationStart({
        supabase,
        userId,
        generationId: slotGenerationId,
        personaId,
        personaName: prep.personaName,
        videoSubject: topic,
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

      results.push({ slotId: slot.id, slotAt: slot.slot_at, topic, taskId: engineTask.taskId, status: 'generating' });
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
        topic,
        scheduleId: idem.scheduleId,
        errorCode: dispatchError.errorCode,
      });
      results.push({ slotId: slot.id, slotAt: slot.slot_at, topic, taskId: null, status: 'failed', errorCode: dispatchError.errorCode });
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
      numberOfVideos: topics.length,
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
    numberOfVideos: topics.length,
    tasksAccepted: accepted,
    tasksFailed: failed,
    tokenCost: totalCost,
    durationMs,
  });

  return NextResponse.json({ success: true, ...envelope });
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
// The user id is resolved lazily, only when a 5xx is actually reported.
//---------------
export const POST = withApiErrorReporting(ROUTE, postHandler, { getUserId: resolveReportingUserId });
