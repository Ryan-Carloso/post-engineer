//---------------
// Server fetch of the engine voice catalog the persona picker uses
// (GET /api/v1/personas/voices). Shared by GET /api/persona/voices and
// generate-and-schedule so dispatch applies the same catalogIds the UI
// already uses to warn about a retired house voice.
//---------------

import { engineAuthHeaders } from '@/lib/request-auth';
import { engineBaseUrl } from '@/lib/engine-proxy';
import { logger } from '@/lib/logger';
import { isVoiceOption, toVoiceOption, type VoiceOption } from '@/lib/voice-catalog';

export type VoiceCatalogFetchResult =
  | { ok: true; voices: VoiceOption[] }
  | { ok: false; status: 500 | 502; error: string };

export async function fetchPersonaVoiceOptions(userId: string): Promise<VoiceCatalogFetchResult> {
  let baseUrl: string;
  try {
    baseUrl = engineBaseUrl();
  } catch (error) {
    logger.error('[voice-catalog-fetch] env missing', error);
    return {
      ok: false,
      status: 500,
      error: error instanceof Error ? error.message : 'Configuration error.',
    };
  }
  try {
    const upstream = await fetch(`${baseUrl}/api/v1/personas/voices`, {
      headers: engineAuthHeaders(userId),
      cache: 'no-store',
    });
    if (!upstream.ok) {
      logger.error('[voice-catalog-fetch] engine error', undefined, { status: upstream.status });
      return { ok: false, status: 502, error: 'Voices unavailable.' };
    }
    const envelope: { body?: unknown } = await upstream.json();
    const data = envelope.body;
    if (!Array.isArray(data) || !data.every(isVoiceOption)) {
      return { ok: false, status: 502, error: 'Invalid voices payload.' };
    }
    return { ok: true, voices: data.map(toVoiceOption) };
  } catch (error) {
    logger.error('[voice-catalog-fetch] engine unreachable', error);
    return { ok: false, status: 502, error: 'Voices service unreachable.' };
  }
}

/** Catalog ids for resolvePersonaVoice. Undefined means "catalog not
 *  loaded": omit catalogIds so a fetch failure cannot retire every house
 *  voice. */
export async function fetchPersonaVoiceCatalogIds(userId: string): Promise<ReadonlySet<string> | undefined> {
  const result = await fetchPersonaVoiceOptions(userId);
  if (!result.ok || result.voices.length === 0) return undefined;
  return new Set(result.voices.map((voice) => voice.id));
}
