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
import type { FaceQuality, VideoType } from '@/lib/tokens';
import {
  resolvePersonaVoice,
  VOICE_FALLBACK_REASONS,
  VOICE_FALLBACK_WARNING_CODE,
  type VoiceFallbackInfo,
  type VoiceResolution,
} from '@/lib/voice-fallback';
import { fetchPersonaVoiceCatalogIds } from '@/lib/voice-catalog-fetch';
import { cloneVoiceAvailable, validatePersonaVoiceInput } from '@/lib/persona-voice-validate';
export { cloneVoiceAvailable } from '@/lib/persona-voice-validate';
import { signedUrl, resolvePostWithoutPersona, type PersonaPrep } from './persona-prep';
import { parsePersonaCtaType } from '@/lib/persona-schema';

export const ROUTE = 'POST /api/videos/generate-and-schedule';

export const MAX_TITLE_CHARS = 300;

export function coded(
  status: number,
  code: ErrorCode,
  message: string,
  field?: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return apiErrorResponse(status, message, { code, field, route: ROUTE, extra });
}

export function validationFailed(
  code: ErrorCode,
  message: string,
  field?: string,
  status = 400,
): NextResponse {
  trackApiEvent('video_creation_validation_failed', { errorCode: code, field: field ?? null });
  return coded(status, code, message, field);
}

export class SlotDispatchError extends Error {
  readonly errorCode: string;
  readonly reason?: string;

  constructor(errorCode: string, message: string, reason?: string) {
    super(message);
    this.name = 'SlotDispatchError';
    this.errorCode = errorCode;
    this.reason = reason;
  }
}

export async function preparePersona(
  supabase: SupabaseClient,
  userId: string,
  personaId: string,
  opts: {
    videoType: VideoType;
    audioUrl?: string;
    imageId?: string;
    voiceId?: string;
    videoAspect?: '9:16' | '16:9' | '1:1';
    videoLayout?: 'standard' | 'react';
    hookPanel?: boolean;
    paragraphNumber?: number;
    language?: string;
    niche?: string;
  },
): Promise<PersonaPrep | NextResponse> {
  const { data: persona, error: personaError } = await supabase
    .from('personas')
    .select(
      'id, name, photo_path, avatar_url, voice_id, voice_audio_path, language, video_aspect, video_layout, hook_panel, cta_type, cta_url, cta_instruction, paragraph_number, niche, face_quality',
    )
    .eq('id', personaId)
    .eq('user_id', userId)
    .single();

  if (personaError || !persona) {
    if (personaError && personaError.code !== 'PGRST116') {
      logger.error('[generate-and-schedule] persona lookup failed', personaError, { userId });
      return coded(500, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
    }
    return validationFailed(ERROR_CODES.PERSONA_NOT_FOUND, formatErrorMessage(ERROR_CODES.PERSONA_NOT_FOUND), 'personaId', 404);
  }

  const niche = (persona.niche as string | null) ?? null;
  if (niche && niche.trim().length > 0 && niche.length > MAX_TITLE_CHARS) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'Persona niche must be at most 300 characters: update the persona.', 'personaId');
  }
  const language = (persona.language as string | null) ?? null;
  if (language && language.trim().length > 0 && language.length > 35) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'Persona language must be at most 35 characters: update the persona.', 'personaId');
  }
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
  const voiceover = opts.videoType === 'voiceover';
  const avatarUrl = (persona.avatar_url as string | null) ?? null;
  if (!voiceover && !opts.imageId && avatarUrl && !isEngineUsablePersonaImageUrl(avatarUrl)) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'Persona image URL must be a valid http(s) URL or a data:image/ URI: update the persona.', 'personaId');
  }
  const photoPath = (persona.photo_path as string | null) ?? null;
  if (!voiceover && !opts.imageId && avatarUrl === null && photoPath === null) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, `options.videoType ${opts.videoType} requires a persona with a photo.`, 'options.videoType');
  }
  const voiceAudioUrl = opts.audioUrl ?? (await signedUrl(supabase, (persona.voice_audio_path as string | null) ?? null));
  let voiceIdValue = opts.audioUrl ? undefined : (opts.voiceId || (persona.voice_id as string | null) || undefined);

  let voiceFallback: VoiceFallbackInfo | undefined;
  if (!voiceAudioUrl && opts.voiceId === undefined && !persona.voice_audio_path) {
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
      return validationFailed(
        ERROR_CODES.VOICE_UNAVAILABLE,
        formatErrorMessage(ERROR_CODES.VOICE_UNAVAILABLE),
        'personaId',
      );
    }
    if (resolution.kind === 'fallback') {
      voiceFallback = { fromVoice: resolution.fromVoice, toVoice: resolution.toVoice, reason: resolution.reason };
      voiceIdValue = resolution.toVoice;
    }
  }

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
    voiceover,
    faceQuality,
    voiceAudioUrl,
    voiceIdValue,
    voiceFallback,
    avatarUrl,
    photoPath,
    niche: opts.niche ?? niche,
    cta: {
      type: parsePersonaCtaType(persona.cta_type as string | null),
      url: (persona.cta_url as string | null) || null,
      instruction: (persona.cta_instruction as string | null) || null,
    },
    language: effectiveLanguage,
    videoAspect: opts.videoAspect ?? ((persona.video_aspect as string | null) ?? null),
    videoLayout: opts.videoLayout ?? ((persona.video_layout as string | null) ?? null),
    hookPanel: opts.hookPanel ?? persona.hook_panel !== false,
    paragraphNumber: opts.paragraphNumber ?? paragraphNumber,
    photoRequired: !voiceover,
  };
}

export async function persistVoiceSwap(
  supabase: SupabaseClient,
  userId: string,
  personaId: string,
  info: VoiceFallbackInfo,
): Promise<void> {
  try {
    const { error } = await supabase
      .from('personas')
      .update({ voice_id: info.toVoice })
      .eq('id', personaId)
      .eq('user_id', userId);
    if (error) {
      logger.error('[generate-and-schedule] failed to persist the swapped persona voice', {
        personaId,
        userId,
        code: error.code,
      });
    }
    const props = scrubSecrets({
      from_voice: info.fromVoice,
      to_voice: info.toVoice,
      reason: info.reason,
      from_voice_present: info.reason !== VOICE_FALLBACK_REASONS.VOICE_MISSING,
    });
    for (const [k, v] of Object.entries(props)) {
      if (typeof v === 'string') props[k] = redactCredentialFragments(v).slice(0, 500);
    }
    getPostHogServer()?.captureAs(userId, VOICE_FALLBACK_WARNING_CODE, props);
  } catch (error) {
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : undefined;
    logger.error('[generate-and-schedule] persistVoiceSwap threw; swap persisted no-op', {
      personaId,
      userId,
      ...(code === undefined ? {} : { code }),
    });
  }
}

export async function preparePost(
  supabase: SupabaseClient,
  userId: string,
  personaId: string | null,
  opts: {
    videoType: VideoType;
    audioUrl?: string;
    imageId?: string;
    voiceId?: string;
    videoAspect?: '9:16' | '16:9' | '1:1';
    videoLayout?: 'standard' | 'react';
    hookPanel?: boolean;
    paragraphNumber?: number;
    language?: string;
    niche?: string;
  },
): Promise<PersonaPrep | NextResponse> {
  if (personaId === null) {
    const prep = resolvePostWithoutPersona(opts);
    return validateExplicitVoice(supabase, userId, opts, prep);
  }
  const prep = await preparePersona(supabase, userId, personaId, opts);
  if (prep instanceof NextResponse) return prep;
  return validateExplicitVoice(supabase, userId, opts, prep);
}

async function validateExplicitVoice(
  supabase: SupabaseClient,
  userId: string,
  opts: { voiceId?: string },
  prep: PersonaPrep,
): Promise<PersonaPrep | NextResponse> {
  if (opts.voiceId === undefined || prep.voiceAudioUrl) return prep;
  if (opts.voiceId.trim().length === 0) return prep;
  const voiceError = await validatePersonaVoiceInput(supabase, userId, opts.voiceId);
  if (voiceError) {
    return validationFailed(ERROR_CODES.UNKNOWN_VOICE, voiceError, 'options.voiceId');
  }
  return prep;
}
