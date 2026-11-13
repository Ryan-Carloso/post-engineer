// Persona prep for a post without a persona.
//
// Extracted from route.ts so the route module stays under the file-size
// ratchet. PersonaPrep is the snapshot the engine reads at tick time.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getPersonaDefaultAccounts,
  type PersonaDefaultAccounts,
} from '@/lib/persona-publishing-accounts';
import { IMAGE_BUCKET } from '@/lib/persona-images';
import { logger } from '@/lib/logger';
import type { FaceQuality } from '@/lib/tokens';
import type { VoiceFallbackInfo } from '@/lib/voice-fallback';

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
  /** The persona's call to action (null = the engine picks a generic one). */
  ctaText: string | null;
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
): Promise<Record<string, string[] | undefined>> {
  const accounts = explicitAccounts ?? {};
  if (Object.keys(accounts).length === 0 && personaId !== null) {
    return bound ?? (await getPersonaDefaultAccounts(supabase, personaId));
  }
  return accounts;
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
    // No persona, no persona call to action: the engine picks a generic one.
    ctaText: null,
    language: opts.language ?? null,
    videoAspect: opts.videoAspect ?? null,
    videoLayout: opts.videoLayout ?? null,
    paragraphNumber: opts.paragraphNumber ?? null,
    photoRequired: false,
  };
}
