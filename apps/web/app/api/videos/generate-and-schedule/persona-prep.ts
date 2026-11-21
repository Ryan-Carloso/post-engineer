import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { apiErrorResponse } from '@/lib/api-error';
import { trackApiEvent } from '@/lib/analytics';
import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import {
  getPersonaDefaultAccounts,
  type PersonaDefaultAccounts,
} from '@/lib/persona-publishing-accounts';
import { IMAGE_BUCKET } from '@/lib/persona-images';
import { logger } from '@/lib/logger';
import type { FaceQuality } from '@/lib/tokens';
import type { VoiceFallbackInfo } from '@/lib/voice-fallback';
import type { ResolvedCta } from './cta-validation';

export const SIGNED_URL_TTL_SECONDS = 24 * 3600;

export async function signedUrl(
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

export interface PersonaPrep {
  personaName: string;
  faceless: boolean;
  faceQuality: FaceQuality;
  voiceAudioUrl?: string;
  voiceIdValue?: string;
  voiceFallback?: VoiceFallbackInfo;
  avatarUrl: string | null;
  photoPath: string | null;
  niche: string | null;
  cta: ResolvedCta | null;
  language: string | null;
  videoAspect: string | null;
  videoLayout: string | null;
  hookPanel: boolean;
  paragraphNumber: number | null;
  photoRequired: boolean;
}

export async function resolvePublishingAccounts(
  supabase: SupabaseClient,
  personaId: string | null,
  explicitAccounts: Record<string, string[] | undefined> | undefined,
  bound?: PersonaDefaultAccounts,
  userId?: string,
): Promise<Record<string, string[] | undefined>> {
  const accounts = explicitAccounts ?? {};
  if (Object.keys(accounts).length === 0 && personaId !== null) {
    if (bound !== undefined) return bound;
    if (userId === undefined) {
      throw new Error('Failed to load persona: owner is required.');
    }
    return getPersonaDefaultAccounts(supabase, personaId, userId);
  }
  return accounts;
}

const GENERATE_ROUTE = 'POST /api/videos/generate-and-schedule';

export async function loadBoundPublishingAccounts(
  supabase: SupabaseClient,
  personaId: string | null,
  userId: string,
): Promise<PersonaDefaultAccounts | null | NextResponse> {
  if (personaId === null) return null;
  try {
    return await getPersonaDefaultAccounts(supabase, personaId, userId);
  } catch (error) {
    if ((error as { code?: string }).code === ERROR_CODES.PERSONA_NOT_FOUND) {
      trackApiEvent('video_creation_validation_failed', {
        errorCode: ERROR_CODES.PERSONA_NOT_FOUND,
        field: 'personaId',
      });
      return apiErrorResponse(404, formatErrorMessage(ERROR_CODES.PERSONA_NOT_FOUND), {
        route: GENERATE_ROUTE,
        code: ERROR_CODES.PERSONA_NOT_FOUND,
        field: 'personaId',
      });
    }
    logger.error('[generate-and-schedule] persona binding lookup failed', error, { userId, personaId });
    return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
      route: GENERATE_ROUTE,
      code: ERROR_CODES.INTERNAL_ERROR,
      cause: error,
    });
  }
}

export function resolvePostWithoutPersona(opts: {
  audioUrl?: string;
  voiceId?: string;
  videoAspect?: '9:16' | '16:9' | '1:1';
  videoLayout?: 'standard' | 'react';
  hookPanel?: boolean;
  paragraphNumber?: number;
  language?: string;
  niche?: string;
}): PersonaPrep {
  return {
    personaName: 'Post',
    faceless: true,
    faceQuality: 'ok',
    voiceAudioUrl: opts.audioUrl,
    voiceIdValue: opts.voiceId,
    avatarUrl: null,
    photoPath: null,
    niche: opts.niche ?? null,
    cta: null,
    language: opts.language ?? null,
    videoAspect: opts.videoAspect ?? null,
    videoLayout: opts.videoLayout ?? null,
    hookPanel: opts.hookPanel ?? true,
    paragraphNumber: opts.paragraphNumber ?? null,
    photoRequired: false,
  };
}
