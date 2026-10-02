//---------------
// POST /api/videos/generate-and-schedule — the single generate+schedule operation.
//
// Product rule: a video and its publishing schedule are always born together.
// One request carries 1–10 topics, a persona (required, even for faceless),
// publishing destinations and a publish-time plan. The API validates
// everything, charges the total token cost atomically, creates the schedule
// + slots, dispatches one engine generation per slot and binds each task_id
// to its slot. No orphan videos, no schedule-only creation, no per-video
// manual times, no recurrence.
//
// Backend flow:
//   validate input -> auth -> rate limit -> persona scope + ownership ->
//   providers + accounts -> distribute slots -> window check -> cost ->
//   idempotency pre-checks -> ONE atomic spend_tokens -> insert schedule ->
//   insert slots -> dispatch engine tasks per slot
//   (slot -> generating + task_id, or failed + per-slot refund).
//
// The engine's 60s tick reconciles generating -> ready/failed and publishes
// ready slots at slot_at; the tick never sees our slots while pending:
// scheduled_at stays NULL during dispatch (it would otherwise trigger the
// immediate one-off dispatch path and double-generate).
//---------------

import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { isPersonaAllowed } from '@/lib/api-keys';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES, formatErrorMessage, type ErrorCode } from '@/lib/error-codes';
import {
  distributeSlots,
  SlotDistributionError,
  type DistributedSlot,
} from '@/lib/schedule/slot-distribution';
import { validateScheduleWindow } from '@/lib/schedule-window';
import { computeVideoTokens, toFiniteNumber, type FaceQuality } from '@/lib/tokens';
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
import { IMAGE_BUCKET, recordRecentImageId, resolveVideoImage } from '@/lib/persona-images';
import { resolveIdempotency } from '@/lib/idempotency';
import { VALID_SCHEDULE_PROVIDERS } from '@/app/api/schedule/route';
import { trackApiEvent } from '@/lib/analytics';
import { logger } from '@/lib/logger';

const ROUTE = 'POST /api/videos/generate-and-schedule';
const MAX_TOPICS = 10;
const MAX_TOPIC_CHARS = 300;
const MAX_SCRIPT_PROMPT_CHARS = 2000;
const SIGNED_URL_TTL_SECONDS = 3600;

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
  providers: z.array(z.string()),
  accounts: z.record(z.string(), z.array(z.string())).optional(),
  schedule: PublishingScheduleSchema,
});

const OptionsSchema = z
  .object({
    faceless: z.boolean().optional(),
    audioUrl: z.string().optional(),
    imageId: z.string().optional(),
    scriptPrompt: z.string().optional(),
    scriptPrompts: z.array(z.string()).optional(),
    webhookUrl: z.string().optional(),
    voiceId: z.string().optional(),
  })
  .optional();

const BodySchema = z.object({
  personaId: z.string(),
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

/** Structured failure: stable code + human message + optional field. */
function coded(
  status: number,
  code: ErrorCode,
  message: string,
  field?: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return apiErrorResponse(status, message, { code, field, route: ROUTE, extra });
}

/** PostgREST unique-violation code. */
function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505';
}

/** signedUrl() never throws: a signing failure resolves to undefined and is
 * classified by the caller's guards — the incident stays diagnosable here. */
async function signedUrl(
  supabase: SupabaseClient,
  path: string | null,
): Promise<string | undefined> {
  if (!path) return undefined;
  try {
    const { data, error } = await supabase.storage
      .from(IMAGE_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error) {
      logger.warn('[generate-and-schedule] failed to sign storage URL', error as unknown as Record<string, unknown>);
    }
    return data?.signedUrl;
  } catch (err) {
    logger.warn('[generate-and-schedule] failed to sign storage URL', err as Record<string, unknown>);
    return undefined;
  }
}

/** Per-slot dispatch failure: marks the slot failed, refunds its prepaid
 * cost, and records history so the failure is never silent. */
class SlotDispatchError extends Error {
  readonly errorCode: string;

  constructor(errorCode: string, message: string) {
    super(message);
    this.name = 'SlotDispatchError';
    this.errorCode = errorCode;
  }
}

//---------------
// Validation helpers — all run BEFORE any token is charged.
//---------------

interface ValidatedInput {
  personaId: string;
  topics: string[];
  providers: Provider[];
  accountIds: Record<Provider, string[]>;
  startAt: string;
  times: string[];
  timezone: string;
  faceless: boolean;
  audioUrl?: string;
  imageId?: string;
  scriptPrompt?: string;
  scriptPrompts?: string[];
  webhookUrl?: string;
  voiceId?: string;
}

/** Track + return a validation failure. Nothing is charged on this path. */
function validationFailed(
  code: ErrorCode,
  message: string,
  field?: string,
  status = 400,
): NextResponse {
  trackApiEvent('video_creation_validation_failed', { errorCode: code, field: field ?? null });
  return coded(status, code, message, field);
}

function validateTopics(rawTopics: string[]): string[] | NextResponse {
  if (rawTopics.length === 0) {
    return validationFailed(ERROR_CODES.TOPICS_REQUIRED, formatErrorMessage(ERROR_CODES.TOPICS_REQUIRED), 'topics');
  }
  if (rawTopics.length > MAX_TOPICS) {
    return validationFailed(
      ERROR_CODES.TOPICS_LIMIT_EXCEEDED,
      formatErrorMessage(ERROR_CODES.TOPICS_LIMIT_EXCEEDED),
      'topics',
    );
  }
  const topics = rawTopics.map((t) => t.trim());
  for (let i = 0; i < topics.length; i += 1) {
    if (topics[i].length === 0) {
      return validationFailed(ERROR_CODES.VALIDATION_FAILED, `Topic ${i + 1} is empty.`, `topics.${i}`);
    }
    if (topics[i].length > MAX_TOPIC_CHARS) {
      return validationFailed(
        ERROR_CODES.VALIDATION_FAILED,
        `Topic ${i + 1} must be at most ${MAX_TOPIC_CHARS} characters.`,
        `topics.${i}`,
      );
    }
  }
  return topics;
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
  const { faceless = false, audioUrl, imageId, scriptPrompt, scriptPrompts, webhookUrl, voiceId } = options;
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
  return { faceless, audioUrl, imageId: imageId?.trim(), scriptPrompt, scriptPrompts, webhookUrl, voiceId: voiceId?.trim() };
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
        windowCheck.error || formatErrorMessage(ERROR_CODES.SCHEDULE_OUT_OF_RANGE),
        'publishing.schedule',
      );
    }
  }
  return slots;
}

//---------------
// Social account validation. One query loads all of the user's accounts;
// each requested id must belong to the user AND to the requested provider.
// More precise than assertAccountsOwned: distinguishes "not yours" from
// "yours but for another provider", with a per-provider field.
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

interface PersonaPrep {
  personaName: string;
  effectiveMix: number;
  faceQuality: FaceQuality;
  voiceAudioUrl?: string;
  voiceIdValue?: string;
  avatarUrl: string | null;
  photoPath: string | null;
  niche: string | null;
  scriptPrompt: string | null;
  language: string | null;
  videoAspect: string | null;
  paragraphNumber: number | null;
  photoRequired: boolean;
}

/**
 * Load the persona (ownership enforced: service-role bypasses RLS, so the
 * user_id predicate is the trust boundary) and resolve the request-level
 * voice/photo inputs. Runs before any token is charged.
 */
async function preparePersona(
  supabase: SupabaseClient,
  userId: string,
  personaId: string,
  opts: { faceless: boolean; audioUrl?: string; imageId?: string; voiceId?: string },
): Promise<PersonaPrep | NextResponse> {
  const { data: persona, error: personaError } = await supabase
    .from('personas')
    .select(
      'id, name, photo_path, avatar_url, voice_id, voice_audio_path, language, video_aspect, script_prompt, paragraph_number, niche, face_mix_percent, face_quality',
    )
    .eq('id', personaId)
    .eq('user_id', userId)
    .single();

  if (personaError || !persona) {
    // PGRST116 = zero rows (not found); anything else is a DB failure,
    // which must not masquerade as "not found".
    if (personaError && personaError.code !== 'PGRST116') {
      logger.error('[generate-and-schedule] persona lookup failed', personaError, { userId });
      return coded(500, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
    }
    return validationFailed(ERROR_CODES.PERSONA_NOT_FOUND, formatErrorMessage(ERROR_CODES.PERSONA_NOT_FOUND), 'personaId', 404);
  }

  // Stored persona values reach the engine verbatim: validate the caps here,
  // before the token gate, so a legacy row fails fast instead of opaque-502.
  const niche = (persona.niche as string | null) ?? null;
  if (niche && niche.trim().length > 0 && niche.length > MAX_TOPIC_CHARS) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'Persona niche must be at most 300 characters: update the persona.', 'personaId');
  }
  const language = (persona.language as string | null) ?? null;
  if (language && language.trim().length > 0 && language.length > 35) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'Persona language must be at most 35 characters: update the persona.', 'personaId');
  }
  const paragraphNumber = (persona.paragraph_number as number | null) ?? null;
  if (
    paragraphNumber !== null &&
    (typeof paragraphNumber !== 'number' || !Number.isInteger(paragraphNumber) || paragraphNumber < 1 || paragraphNumber > 10)
  ) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'Persona paragraph_number must be an integer between 1 and 10: update the persona.', 'personaId');
  }
  const storedMix = (persona.face_mix_percent as number | null) ?? null;
  if (storedMix !== null && (!Number.isFinite(storedMix) || storedMix < 0 || storedMix > 100)) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'Persona face_mix_percent must be a number between 0 and 100: update the persona.', 'personaId');
  }

  // Voice: custom per-request audio wins; otherwise the persona voice.
  // The engine requires exactly one of voice_id / voice_audio_url.
  const voiceAudioUrl = opts.audioUrl ?? (await signedUrl(supabase, (persona.voice_audio_path as string | null) ?? null));
  const voiceIdValue = opts.audioUrl ? undefined : (opts.voiceId || (persona.voice_id as string | null) || undefined);
  if (!voiceAudioUrl && !voiceIdValue) {
    if (persona.voice_audio_path) {
      return coded(503, ERROR_CODES.VALIDATION_FAILED, 'Voice audio is configured for this persona but could not be loaded. Please try again.');
    }
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      'No voice available: the persona has no voice configured and no custom audio_url was provided.',
      'options.audioUrl',
    );
  }

  const faceQuality: FaceQuality = persona.face_quality === 'very_good' ? 'very_good' : 'ok';
  return {
    personaName: (persona.name as string) ?? 'Persona',
    effectiveMix: opts.faceless ? 0 : (storedMix ?? 0),
    faceQuality,
    voiceAudioUrl,
    voiceIdValue,
    avatarUrl: (persona.avatar_url as string | null) ?? null,
    photoPath: (persona.photo_path as string | null) ?? null,
    niche,
    scriptPrompt: (persona.script_prompt as string | null) ?? null,
    language,
    videoAspect: (persona.video_aspect as string | null) ?? null,
    paragraphNumber,
    // A face-requiring persona (mix > 0, or legacy NULL mix) must resolve a
    // photo; only a genuinely faceless request may proceed without one.
    photoRequired: !opts.faceless && (storedMix === null || storedMix > 0),
  };
}

//---------------
// Replay helper: fetch an existing schedule + slots for an idempotent retry.
//---------------
async function fetchReplay(
  supabase: SupabaseClient,
  userId: string,
  scheduleId: string,
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
  return NextResponse.json({
    success: true,
    schedule: { id: scheduleId },
    slots: slots.map((row) => ({
      slotId: (row as { id: string }).id,
      slotAt: (row as { slot_at: string }).slot_at,
      topic: (row as { topic: string }).topic,
      taskId: (row as { task_id: string | null }).task_id,
      status: (row as { status: string }).status,
    })),
    replayed: true,
  });
}

export async function POST(request: Request): Promise<NextResponse> {
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
  const { personaId, publishing, options, idempotencyKey } = parsed.data;
  const { schedule } = publishing;

  if (personaId.trim().length === 0) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'personaId is required.', 'personaId');
  }
  const topics = validateTopics(parsed.data.topics);
  if (topics instanceof NextResponse) return topics;
  const providers = validateProviders(publishing.providers);
  if (providers instanceof NextResponse) return providers;
  const validatedOptions = validateOptions(options ?? {}, topics.length);
  if (validatedOptions instanceof NextResponse) return validatedOptions;
  const slots = validateSlots(schedule.startAt, schedule.times, schedule.timezone, topics.length);
  if (slots instanceof NextResponse) return slots;

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
  // lower than the single video-job one. Keyed by user id.
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

  // 4. Persona scope (API keys) + ownership.
  if (!isPersonaAllowed(auth.personaIds, personaId)) {
    return validationFailed(ERROR_CODES.PERSONA_SCOPE_DENIED, formatErrorMessage(ERROR_CODES.PERSONA_SCOPE_DENIED), 'personaId', 403);
  }
  const prep = await preparePersona(supabase, userId, personaId, {
    faceless: validatedOptions.faceless,
    audioUrl: validatedOptions.audioUrl,
    imageId: validatedOptions.imageId,
    voiceId: validatedOptions.voiceId,
  });
  if (prep instanceof NextResponse) return prep;

  // 5. Providers + social accounts (fail fast: never charge for a bad selection).
  const accountIds = await validateAccounts(supabase, userId, providers, publishing.accounts ?? {});
  if (accountIds instanceof NextResponse) return accountIds;

  // Pinned library image: fail fast when the id does not resolve, before
  // any charge. Per-topic resolution still happens at dispatch time.
  const requestedImageId = validatedOptions.imageId?.trim() || null;
  if (requestedImageId) {
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
  const perVideoCost = computeVideoTokens(prep.effectiveMix, prep.faceQuality);
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
  const idem = resolveIdempotency(userId, idempotencyKey, request);
  const { data: existingSchedule } = await supabase
    .from('schedules')
    .select('id')
    .eq('id', idem.scheduleId)
    .eq('user_id', userId)
    .maybeSingle();
  if (existingSchedule) {
    trackApiEvent('video_creation_replayed', { userId, scheduleId: idem.scheduleId });
    const replayed = await fetchReplay(supabase, userId, idem.scheduleId);
    if (replayed) return replayed;
  }
  // Read-your-ledger: a previous attempt may have spent but died before the
  // schedule insert (no unique constraint on generation_id is assumed).
  // Residual race vs a concurrent duplicate is documented below at insert.
  const { data: ledgerRows } = await supabase
    .from('token_transactions')
    .select('id')
    .eq('generation_id', idem.generationId)
    .limit(1);
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
      if (isUniqueViolation(spendError)) {
        // A concurrent duplicate spent under the same generation_id first:
        // replay instead of double-charging.
        const replayed = await fetchReplay(supabase, userId, idem.scheduleId);
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

  // 9. Insert the schedule. The id is deterministic (idempotency anchor);
  // kind='batch' (a finite prepaid set of slots — never the 'recurring'
  // default, which would trip the partial unique index). scheduled_at stays
  // NULL during dispatch so the engine's immediate one-off path cannot race
  // us and double-generate; the tick only reconciles our generating slots.
  const sortedTimes = [...new Set(schedule.times.map((t) => t.trim()))].sort();
  const { error: scheduleError } = await supabase.from('schedules').insert({
    id: idem.scheduleId,
    user_id: userId,
    persona_id: personaId,
    kind: 'batch',
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
    timezone: schedule.timezone,
    scheduled_at: null,
    active: true,
  });
  if (scheduleError) {
    if (isUniqueViolation(scheduleError)) {
      // Lost a PK race with a concurrent duplicate (or a replay slipped past
      // the pre-check). Do NOT refund: the winner owns the spend under the
      // same generation_id, and refunding could take back the winner's
      // tokens. Surface the existing schedule instead.
      logger.error('[generate-and-schedule] schedule PK race; replaying winner', scheduleError, {
        scheduleId: idem.scheduleId,
        userId,
      });
      trackApiEvent('video_creation_failed', {
        userId,
        scheduleId: idem.scheduleId,
        errorCode: 'IDEMPOTENCY_CONFLICT',
        failureStage: 'schedule_insert_race',
      });
      const replayed = await fetchReplay(supabase, userId, idem.scheduleId);
      if (replayed) return replayed;
    }
    // Real DB failure after the spend: refund the whole generation loudly.
    logger.error('[generate-and-schedule] schedule insert failed after spend; refunding', scheduleError, {
      scheduleId: idem.scheduleId,
      userId,
    });
    await supabase.rpc('refund_generation_tokens', {
      p_user_id: userId,
      p_generation_id: idem.generationId,
      p_reason: 'Unified generate+schedule: schedule insert failed; tokens refunded',
    });
    trackApiEvent('video_creation_failed', { userId, errorCode: ERROR_CODES.INTERNAL_ERROR, failureStage: 'schedule_insert' });
    return coded(500, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
  }
  trackApiEvent('video_schedule_created', {
    userId,
    personaId,
    scheduleId: idem.scheduleId,
    numberOfVideos: topics.length,
    providers,
  });

  // 10. Insert the slots (pending). The id is database-generated; the
  // returned rows carry it for the per-slot dispatch below.
  const { data: slotRows, error: slotsError } = await supabase
    .from('scheduled_posts')
    .insert(
      slots.map((slot, i) => ({
        schedule_id: idem.scheduleId,
        user_id: userId,
        slot_at: slot.slotAtISO,
        status: 'pending',
        topic: topics[i],
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
      if (!validatedOptions.faceless) {
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
          photoUrl = prep.avatarUrl ?? (await signedUrl(supabase, prep.photoPath)) ?? undefined;
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
        script_prompt: prep.scriptPrompt,
        paragraph_number: prep.paragraphNumber,
        niche: prep.niche,
        face_mix_percent: prep.effectiveMix,
        face_quality: prep.faceQuality,
      };
      const payload = buildJobPayload(jobPersona, {
        video_subject: topic,
        video_script_prompt: validatedOptions.scriptPrompts?.[i] ?? validatedOptions.scriptPrompt,
        webhook_url: validatedOptions.webhookUrl,
      });
      if (!hasNonEmptyString(payload.video_subject)) {
        throw new SlotDispatchError('empty_subject', 'Video subject is empty.');
      }

      // History snapshot before dispatch: the row renders even if the
      // persona is later renamed or deleted.
      await recordGenerationStart({
        supabase,
        userId,
        generationId: slotGenerationId,
        personaId,
        personaName: prep.personaName,
        videoSubject: topic,
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
      if (pickedImageId) {
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
    schedule: { id: idem.scheduleId },
    slots: results,
    replayed: false,
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
