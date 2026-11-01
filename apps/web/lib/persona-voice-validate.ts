//---------------
// persona-voice-validate — server-side voice validation for POST/PATCH
// /api/persona (issue #353). It applies the same resolution the video
// dispatch already applies (resolvePersonaVoice), but a voice the engine
// would not accept is now rejected with a 400 pointing at
// GET /api/persona/voices BEFORE any upload, insert or update — instead of
// being silently swapped at video time. The PATCH path validates a voice
// only when it differs from the stored one: the form always resends
// voiceId, and 16 personas still store legacy bare names, so a name-only
// edit must never 400 on the unchanged voice. A catalog fetch failure
// degrades to shape-only validation (exactly what dispatch does).
//---------------

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchPersonaVoiceCatalogIds } from '@/lib/voice-catalog-fetch';
import { cloneKeyOf, isCloneVoiceId } from '@/lib/voice-catalog';
import { resolvePersonaVoice } from '@/lib/voice-fallback';
import { logger } from '@/lib/logger';

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
// UNKNOWN_VOICE copy + rejection options (issue #353 amendment 2/3). The
// exact web copy is shared with the enumerable default in error-codes.ts
// ({attempt} = truncated attempted value, so a looping agent can see what
// it keeps passing and telemetry always agrees with the message).
// personaVoiceRejectionOptions feeds the route errorResponse: the stable
// code travels to the client (parseErrorResponse passes it through) and the
// logMessage keeps the PostHog message keyed by route+code (#301), with the
// attempted voice as a scrubbed property. An empty/absent attempt (the
// 'Provide voiceId.' contract) carries no code.
//---------------

import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';

// Telemetry and copy share one truncation so both always agree.
const MAX_VOICE_ATTEMPT = 100;

export interface VoiceRejectionOptions {
  readonly code: string;
  readonly logMessage: string;
  readonly metadata: Record<string, string>;
}

export function personaVoiceRejectionOptions(
  voiceId: string | null | undefined,
): VoiceRejectionOptions | undefined {
  const attempt = (voiceId ?? '').trim().slice(0, MAX_VOICE_ATTEMPT);
  if (attempt.length === 0) return undefined;
  return {
    code: ERROR_CODES.UNKNOWN_VOICE,
    logMessage: ERROR_CODES.UNKNOWN_VOICE,
    metadata: { voice: attempt },
  };
}

const unknownVoiceMessage = (voiceId: string) =>
  formatErrorMessage(ERROR_CODES.UNKNOWN_VOICE, { attempt: voiceId.slice(0, MAX_VOICE_ATTEMPT) });

/** validatePersonaVoiceInput — null when the voice is acceptable, else the
 *  400 message. Creation requires a voiceId: the empty value keeps the
 *  POST contract ('Provide voiceId.'). Sentinels (no-voice/none) and the
 *  provider ids the engine routes itself (elevenlabs:, openrouter:) pass
 *  without consulting the catalog. */
export async function validatePersonaVoiceInput(
  supabase: SupabaseClient,
  userId: string,
  voiceId: string | null | undefined,
): Promise<string | null> {
  const trimmed = (voiceId ?? '').trim();
  if (trimmed.length === 0) return 'Provide voiceId.';
  const lowered = trimmed.toLowerCase();
  if (lowered === 'no-voice' || lowered === 'none') return null;
  // Sentinels and the provider ids the engine routes itself never consult
  // the catalog; house and clone shapes do (same retirement logic as
  // dispatch, issue #277).
  const needsCatalog = trimmed.startsWith('chatterbox:') || isCloneVoiceId(trimmed);
  const catalogIds = needsCatalog ? await fetchPersonaVoiceCatalogIds(userId) : undefined;
  const cloneAvailable = isCloneVoiceId(trimmed)
    ? await cloneVoiceAvailable(supabase, userId, cloneKeyOf(trimmed) ?? '')
    : undefined;
  const resolution = resolvePersonaVoice(trimmed, null, { catalogIds, cloneAvailable });
  if (resolution.kind === 'valid' || resolution.kind === 'clone') return null;
  return unknownVoiceMessage(trimmed);
}

interface PersonaVoiceRow {
  voice_id?: unknown;
  voice_audio_path?: unknown;
}

/** applyPersonaVoicePatch — the PATCH /api/persona voice block (#353).
 *  Validates the incoming voice ONLY when it differs from the stored one
 *  (trim-exact compare, same convention as the stored ids), then applies
 *  the same write the route already did: voice_id = incoming,
 *  voice_audio_path = null, with the replaced clone audio queued for
 *  cleanup. No voiceId sent → nothing happens. */
export async function applyPersonaVoicePatch(
  supabase: SupabaseClient,
  userId: string,
  persona: PersonaVoiceRow,
  incomingVoiceId: string | null,
  updates: Record<string, unknown>,
  stalePaths: string[],
): Promise<string | null> {
  if (incomingVoiceId === null) return null;
  const stored = typeof persona.voice_id === 'string' ? persona.voice_id : '';
  if (incomingVoiceId.trim() !== stored.trim()) {
    const voiceError = await validatePersonaVoiceInput(supabase, userId, incomingVoiceId);
    if (voiceError) return voiceError;
  }
  updates.voice_id = incomingVoiceId;
  updates.voice_audio_path = null;
  if (typeof persona.voice_audio_path === 'string' && persona.voice_audio_path) {
    stalePaths.push(persona.voice_audio_path);
  }
  return null;
}
