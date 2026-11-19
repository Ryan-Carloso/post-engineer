import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchPersonaVoiceCatalogIds } from '@/lib/voice-catalog-fetch';
import { cloneKeyOf, isCloneVoiceId } from '@/lib/voice-catalog';
import { resolvePersonaVoice } from '@/lib/voice-fallback';
import { logger } from '@/lib/logger';
import { redactCredentialFragments } from '@/lib/scrub';

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

import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';

const MAX_VOICE_ATTEMPT = 80;

export interface VoiceRejectionOptions {
  readonly code: string;
  readonly logMessage: string;
  readonly metadata: Record<string, string>;
  readonly leaveReportingToWrapper: true;
}

export function personaVoiceRejectionOptions(
  voiceId: string | null | undefined,
): VoiceRejectionOptions | undefined {
  const attempt = (voiceId ?? '').trim().slice(0, MAX_VOICE_ATTEMPT);
  if (attempt.length === 0) return undefined;
  return {
    code: ERROR_CODES.UNKNOWN_VOICE,
    logMessage: 'Unknown voice',
    metadata: { voice: redactCredentialFragments(attempt) },
    leaveReportingToWrapper: true,
  };
}

const unknownVoiceMessage = (voiceId: string) =>
  formatErrorMessage(ERROR_CODES.UNKNOWN_VOICE, { attempt: voiceId.slice(0, MAX_VOICE_ATTEMPT) });

export async function validatePersonaVoiceInput(
  supabase: SupabaseClient,
  userId: string,
  voiceId: string | null | undefined,
): Promise<string | null> {
  const trimmed = (voiceId ?? '').trim();
  if (trimmed.length === 0) return 'Provide voiceId.';
  const lowered = trimmed.toLowerCase();
  if (lowered === 'no-voice' || lowered === 'none') return null;
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
