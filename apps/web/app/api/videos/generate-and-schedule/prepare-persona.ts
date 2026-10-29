//---------------
// Persona prep for a post WITH a persona (and the shared response
// helpers). Extracted from route.ts so the route module stays under the
// file-size ratchet; the voice fallback lives here too (issue #277): it is
// the last validation step before any token is charged or any render/TTS
// starts, and it is what turns a legacy persona's broken voice into a
// working one instead of a mid-generation failure.
//---------------

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES, formatErrorMessage, type ErrorCode } from '@/lib/error-codes';
import { isEnglishLanguage, ONLY_ENGLISH_VIDEOS_MESSAGE } from '@/lib/language-gate';
import { isEngineUsablePersonaImageUrl } from '@/lib/engine-image-url';
import { getPostHogServer } from '@/lib/posthog-server';
import { logger } from '@/lib/logger';
import { trackApiEvent } from '@/lib/analytics';
import { scrubSecrets, redactCredentialFragments } from '@/lib/scrub';
import type { FaceQuality } from '@/lib/tokens';
import {
  resolvePersonaVoice,
  VOICE_FALLBACK_REASONS,
  VOICE_FALLBACK_WARNING_CODE,
  type VoiceFallbackInfo,
  type VoiceResolution,
} from '@/lib/voice-fallback';
import { fetchPersonaVoiceCatalogIds } from '@/lib/voice-catalog-fetch';
import { signedUrl, resolvePostWithoutPersona, type PersonaPrep } from './persona-prep';

export const ROUTE = 'POST /api/videos/generate-and-schedule';

/** Persona niche cap, mirroring the persona's own validation. Shared with
 *  route.ts's input validation so both spell one limit. */
export const MAX_TITLE_CHARS = 300;

/** Structured failure: stable code + human message + optional field. */
export function coded(
  status: number,
  code: ErrorCode,
  message: string,
  field?: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return apiErrorResponse(status, message, { code, field, route: ROUTE, extra });
}

/** Track + return a validation failure. Nothing is charged on this path. */
export function validationFailed(
  code: ErrorCode,
  message: string,
  field?: string,
  status = 400,
): NextResponse {
  trackApiEvent('video_creation_validation_failed', { errorCode: code, field: field ?? null });
  return coded(status, code, message, field);
}

/** Per-slot dispatch failure: marks the slot failed, refunds its prepaid
 * cost, and records history so the failure is never silent. */
export class SlotDispatchError extends Error {
  readonly errorCode: string;

  constructor(errorCode: string, message: string) {
    super(message);
    this.name = 'SlotDispatchError';
    this.errorCode = errorCode;
  }
}

/**
 * Load the persona (ownership enforced: service-role bypasses RLS, so the
 * user_id predicate is the trust boundary) and resolve the request-level
 * voice/photo inputs. Runs before any token is charged.
 */
export async function preparePersona(
  supabase: SupabaseClient,
  userId: string,
  personaId: string,
  opts: {
    faceless: boolean;
    audioUrl?: string;
    imageId?: string;
    voiceId?: string;
    scriptPrompt?: string;
    videoAspect?: '9:16' | '16:9';
    videoLayout?: 'standard' | 'react';
    paragraphNumber?: number;
    language?: string;
    niche?: string;
  },
): Promise<PersonaPrep | NextResponse> {
  const { data: persona, error: personaError } = await supabase
    .from('personas')
    .select(
      'id, name, photo_path, avatar_url, voice_id, voice_audio_path, language, video_aspect, video_layout, script_prompt, cta_text, paragraph_number, niche, face_quality',
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
  if (niche && niche.trim().length > 0 && niche.length > MAX_TITLE_CHARS) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'Persona niche must be at most 300 characters: update the persona.', 'personaId');
  }
  const language = (persona.language as string | null) ?? null;
  if (language && language.trim().length > 0 && language.length > 35) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'Persona language must be at most 35 characters: update the persona.', 'personaId');
  }
  // English-only launch: the effective language (per-post override, else
  // the persona's stored language) must be English — a legacy persona in
  // another language cannot create videos until the lock lifts.
  const effectiveLanguage = opts.language ?? language;
  if (effectiveLanguage && effectiveLanguage.trim().length > 0 && !isEnglishLanguage(effectiveLanguage)) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, ONLY_ENGLISH_VIDEOS_MESSAGE, 'personaId');
  }
  const paragraphNumber = (persona.paragraph_number as number | null) ?? null;
  if (
    paragraphNumber !== null &&
    (typeof paragraphNumber !== 'number' || !Number.isInteger(paragraphNumber) || paragraphNumber < 1 || paragraphNumber > 10)
  ) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'Persona paragraph_number must be an integer between 1 and 10: update the persona.', 'personaId');
  }
  // Persona image: a faced post sends the stored avatar_url to the engine,
  // which only discovers an unusable one at ~75% of the pipeline — after the
  // charge ("persona image download rejected"). Fail fast here instead.
  // Skipped for faceless posts (no photo is sent) and for a pinned library
  // image, which replaces the persona photo and is checked separately below.
  const avatarUrl = (persona.avatar_url as string | null) ?? null;
  if (!opts.faceless && !opts.imageId && avatarUrl && !isEngineUsablePersonaImageUrl(avatarUrl)) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'Persona image URL must be a valid http(s) URL or a data:image/ URI: update the persona.', 'personaId');
  }
  // Voice: custom per-request audio wins; otherwise the persona voice.
  // The engine requires exactly one of voice_id / voice_audio_url.
  const voiceAudioUrl = opts.audioUrl ?? (await signedUrl(supabase, (persona.voice_audio_path as string | null) ?? null));
  let voiceIdValue = opts.audioUrl ? undefined : (opts.voiceId || (persona.voice_id as string | null) || undefined);

  //---------------
  // Voice fallback (issue #277): the persona's stored voice is validated
  // BEFORE any charge or engine work, so a legacy/broken voice no longer
  // burns render or TTS on a mid-generation "unknown voice" failure. An
  // invalid (or absent) voice is swapped for the house default of the
  // persona's language — its own gender when the stored id spells one —
  // and the swap is persisted on the persona and reported to the user.
  // An EXPLICIT per-request voice is never swapped: it is the caller's own
  // choice, and the engine already fails loudly on one it cannot route.
  // A clone's availability is per-user data, checked here; the engine's
  // ownership guard stays the last line of defense.
  //---------------
  let voiceFallback: VoiceFallbackInfo | undefined;
  // A persona configured for AUDIO voice keeps the transient 503 when its
  // audio cannot be signed — the fallback repairs only a persona with no
  // usable voice configured at all.
  if (!voiceAudioUrl && opts.voiceId === undefined && !persona.voice_audio_path) {
    // Catalog is only consulted for chatterbox / chatterbox_nano ids
    // (retired house voices and clone rows). Sentinels, elevenlabs,
    // openrouter, and bare ids never read it — skip the engine round-trip.
    const storedId = (voiceIdValue ?? '').trim();
    const needsCatalog =
      storedId.startsWith('chatterbox:') || storedId.startsWith('chatterbox_nano:');
    const catalogIds = needsCatalog ? await fetchPersonaVoiceCatalogIds(userId) : undefined;
    const catalogOpts = catalogIds === undefined ? {} : { catalogIds };
    let resolution: VoiceResolution = resolvePersonaVoice(
      voiceIdValue ?? null,
      effectiveLanguage,
      catalogOpts,
    );
    if (resolution.kind === 'clone') {
      resolution = resolvePersonaVoice(voiceIdValue, effectiveLanguage, {
        ...catalogOpts,
        cloneAvailable: await cloneVoiceAvailable(supabase, userId, resolution.key),
      });
    }
    if (resolution.kind === 'unavailable') {
      // No valid voice exists for the persona's language — fail before any
      // spend instead of rendering a video with no usable voice.
      return validationFailed(
        ERROR_CODES.VOICE_UNAVAILABLE,
        formatErrorMessage(ERROR_CODES.VOICE_UNAVAILABLE),
        'personaId',
      );
    }
    if (resolution.kind === 'fallback') {
      voiceFallback = { fromVoice: resolution.fromVoice, toVoice: resolution.toVoice, reason: resolution.reason };
      voiceIdValue = resolution.toVoice;
      // Persist after the last route validation that can still 400, so a
      // rejected request cannot silently rewrite personas.voice_id.
    }
  }

  if (!voiceAudioUrl && !voiceIdValue) {
    if (persona.voice_audio_path) {
      return coded(503, ERROR_CODES.VALIDATION_FAILED, 'Voice audio is configured for this persona but could not be loaded. Please try again.');
    }
    // Unreachable in practice (the resolution above always produces a voice
    // for an English persona), kept as the fail-closed guard.
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      'No voice available: the persona has no voice configured and no custom audio_url was provided.',
      'options.audioUrl',
    );
  }

  const faceQuality: FaceQuality = persona.face_quality === 'very_good' ? 'very_good' : 'ok';
  return {
    personaName: (persona.name as string) ?? 'Persona',
    // The per-post choice, carried through to pricing, the engine payload and
    // the slot row (the engine's batch pipeline reads it from there). There
    // is no persona-level mix anymore: a persona is always faced.
    faceless: opts.faceless,
    faceQuality,
    voiceAudioUrl,
    voiceIdValue,
    voiceFallback,
    avatarUrl,
    photoPath: (persona.photo_path as string | null) ?? null,
    // The persona's editorial definition, each overridable per post. These
    // resolved values are snapshotted onto the schedule (not re-read at tick
    // time), so a persona edited after this moment cannot rewrite this video.
    niche: opts.niche ?? niche,
    scriptPrompt: opts.scriptPrompt ?? ((persona.script_prompt as string | null) ?? null),
    ctaText: (persona.cta_text as string | null) ?? null,
    language: effectiveLanguage,
    videoAspect: opts.videoAspect ?? ((persona.video_aspect as string | null) ?? null),
    // Layout is snapshotted like aspect: a persona edited after this moment
    // must not rewrite how this post was composed.
    videoLayout: opts.videoLayout ?? ((persona.video_layout as string | null) ?? null),
    paragraphNumber: opts.paragraphNumber ?? paragraphNumber,
    // Every persona is faced, so a post WITH the face must resolve one; only a
    // faceless post may proceed without any image.
    photoRequired: !opts.faceless,
  };
}

//---------------
// cloneVoiceAvailable — whether the persona's clone id still names one of
// this user's READY clones (cloned_voices, migration 023). The engine_key
// is the persona id's key half without the routing prefix. A failed lookup
// resolves true (fail open): the engine's ownership guard at TTS time is
// the last line of defense, and a transient DB error must not fail a
// dispatch the engine would accept.
//---------------
export async function cloneVoiceAvailable(
  supabase: SupabaseClient,
  userId: string,
  key: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('cloned_voices')
      .select('engine_voice_key')
      .eq('user_id', userId)
      .eq('engine_voice_key', key)
      .eq('status', 'ready')
      .limit(1);
    if (error) {
      logger.error('[generate-and-schedule] cloned voice availability lookup failed', error, { userId });
      return true;
    }
    return (data ?? []).length > 0;
  } catch (error) {
    logger.error('[generate-and-schedule] cloned voice availability lookup threw', error, { userId });
    return true;
  }
}

//---------------
// persistVoiceSwap — writes the fallback voice onto the persona row and
// fires the `voice_fallback_applied` PostHog event (from_voice/to_voice/
// reason, voice ids only — no personal data). Never fails the dispatch:
// the payload already carries the working voice, and a failed persist only
// means the next post repeats the same swap.
//---------------
export async function persistVoiceSwap(
  supabase: SupabaseClient,
  userId: string,
  personaId: string,
  info: VoiceFallbackInfo,
): Promise<void> {
  // GUARDED as a whole (review MINOR): a failed persist (DB throw, PostHog
  // throw) must NEVER break the dispatch — the payload already carries the
  // working voice for THIS request, and a failed persist only means the
  // next post repeats the same swap. Errors are logged, never rethrown.
  try {
    // The service-role client bypasses RLS: re-check ownership with the
    // explicit user_id predicate.
    const { error } = await supabase
      .from('personas')
      .update({ voice_id: info.toVoice })
      .eq('id', personaId)
      .eq('user_id', userId);
    if (error) {
      logger.error('[generate-and-schedule] failed to persist the swapped persona voice', error, {
        personaId,
        userId,
      });
    }
    // Voice ids can carry user-typed fragments or clone ids; scrub the same
    // way trackApiEvent does (secret keys + credential fragments + 500 cap)
    // while keeping captureAs so the event stays attributed to the user.
    // scrubSecrets handles secret keys; redactCredentialFragments handles fragments inside values.
    const props = scrubSecrets({
      from_voice: info.fromVoice,
      to_voice: info.toVoice,
      reason: info.reason,
      // The reason 'voice_missing' carries an empty from_voice: there was no
      // stored voice to name.
      from_voice_present: info.reason !== VOICE_FALLBACK_REASONS.VOICE_MISSING,
    });
    for (const [k, v] of Object.entries(props)) {
      if (typeof v === 'string') props[k] = redactCredentialFragments(v).slice(0, 500);
    }
    getPostHogServer()?.captureAs(userId, VOICE_FALLBACK_WARNING_CODE, props);
  } catch (error) {
    logger.error('[generate-and-schedule] persistVoiceSwap threw; swap persisted no-op', error, {
      personaId,
      userId,
    });
  }
}

/**
 * Resolve what the video needs: the persona's editorial definition (voice,
 * script, aspect, niche, language) or — for a post created without one —
 * the request's own options. The resolved values are snapshotted onto the
 * schedule so the engine never has to re-derive them at tick time, and so
 * editing the persona later cannot rewrite an already-queued video.
 *
 * The persona lookup enforces ownership explicitly: the service client
 * bypasses RLS, so the user_id predicate is the trust boundary.
 */
export async function preparePost(
  supabase: SupabaseClient,
  userId: string,
  personaId: string | null,
  opts: {
    faceless: boolean;
    audioUrl?: string;
    imageId?: string;
    voiceId?: string;
    scriptPrompt?: string;
    videoAspect?: '9:16' | '16:9';
    videoLayout?: 'standard' | 'react';
    paragraphNumber?: number;
    language?: string;
    niche?: string;
  },
): Promise<PersonaPrep | NextResponse> {
  if (personaId === null) {
    return resolvePostWithoutPersona(opts);
  }
  return preparePersona(supabase, userId, personaId, opts);
}
