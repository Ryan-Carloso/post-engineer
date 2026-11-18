// Persona prep for a post without a persona.
//
// Extracted from route.ts so the route module stays under the file-size
// ratchet. PersonaPrep is the snapshot the engine reads at tick time.
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

// Generation URLs must outlive the serial render queue: the engine renders
// one video at a time (~15 min each), so the last slot of a batch is picked
// up hours after creation. This matches the engine's fill_schedule horizon
// (apps/engine/app/services/fill_schedule/constants.py: SIGNED_URL_EXPIRES_SECONDS = 24 * 3600).
// Shared with lib/engine-image-url.ts: the house-character re-host signs
// with the same horizon, so the two generation-time signings cannot drift.
export const SIGNED_URL_TTL_SECONDS = 24 * 3600;

/** signedUrl() never throws: a signing failure resolves to undefined and is
 * classified by the caller's guards — the incident stays diagnosable here. */
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
  /** Per-post "no face" choice, derived from options.videoType. */
  faceless: boolean;
  faceQuality: FaceQuality;
  voiceAudioUrl?: string;
  voiceIdValue?: string;
  /** The applied voice swap (issue #277): the persona's stored voice was
   *  invalid and the dispatch speaks with toVoice instead. Surfaced in the
   *  response as a stable warning so the UI can tell the user. */
  voiceFallback?: VoiceFallbackInfo;
  avatarUrl: string | null;
  photoPath: string | null;
  niche: string | null;
  /** The persona's CTA intent (issue #639): type plus facts, never wording.
   * Null on a faceless post: no persona, no persona CTA. */
  cta: ResolvedCta | null;
  language: string | null;
  videoAspect: string | null;
  videoLayout: string | null;
  paragraphNumber: number | null;
  photoRequired: boolean;
}

//---------------
// resolvePostWithoutPersona — a faceless post defined entirely by the
// request. Everything the engine reads off a persona is supplied here and
// snapshotted; the caller already refused a persona-less post that is not
// faceless or that carries no voice.
//---------------
// resolvePublishingAccounts — which accounts a generate-and-schedule call
// publishes to. When publishing.accounts is omitted entirely and the post
// has a persona, fall back to the persona's bound publishing accounts
// (issue #212, binding made mandatory by issue #572); explicit accounts
// always win. With no binding either, validateAccounts keeps its 400
// behavior. `bound` is the already-loaded binding (the caller loads it
// once and reuses it for the binding check); without it the fallback is
// fetched here.
//
// Lives here (not in route.ts) so the route module stays under the
// file-size ratchet.
//---------------
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

//---------------
// loadBoundPublishingAccounts — the one binding read the route reuses.
// A persona-less post has nothing to load. PERSONA_NOT_FOUND is the same
// 404 preparePost already returns for the editorial lookup; a database
// error is a logged 500. Both used to escape the handler, because
// getPersonaDefaultAccounts throws and the route did not catch it.
//---------------
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
  paragraphNumber?: number;
  language?: string;
  niche?: string;
}): PersonaPrep {
  return {
    // The display name for the notification; a persona-less post has no
    // persona name, so it is identified by its own shape.
    personaName: 'Post',
    faceless: true,
    // No persona to price: a faceless post ignores face quality, so the
    // snapshot stores the default.
    faceQuality: 'ok',
    voiceAudioUrl: opts.audioUrl,
    voiceIdValue: opts.voiceId,
    avatarUrl: null,
    photoPath: null,
    niche: opts.niche ?? null,
    // No persona, no persona CTA: only a per-video override can add one.
    cta: null,
    language: opts.language ?? null,
    videoAspect: opts.videoAspect ?? null,
    videoLayout: opts.videoLayout ?? null,
    paragraphNumber: opts.paragraphNumber ?? null,
    photoRequired: false,
  };
}
