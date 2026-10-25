//---------------
// voice-fallback — fail-fast persona-voice resolution (issue #277).
//
// Before a video job is dispatched the persona's voice id is validated
// against the engine's real routing rules (voice.tts). An invalid voice
// used to be discovered at TTS time (stage `audio`) — after the charge and
// often after partial render work. Now it is resolved HERE and swapped for
// the house default voice of the persona's own language and, when it can be
// told from the stored id, gender. The swap is persisted on the persona and
// reported to the user (stable warning code below), never silent.
//
// What counts as VALID (must mirror the engine's voice.tts routing):
// - `no-voice` / `none` — the explicit silence sentinel;
// - `elevenlabs:<voice_id>` — the provider validates the id itself;
// - `openrouter:<model>:<voice>` — routed by prefix (the voice half may
//   carry its own colons, e.g. Azure ids);
// - `chatterbox:<name>` / `chatterbox_nano:<key>` — house voices and
//   clones. House names are only provably valid when the served catalog is
//   supplied (`catalogIds`): the catalog is the engine's own list, so a
//   name it no longer serves is retired. Clone ids are per-user rows —
//   without the catalog the caller must check availability itself.
//
// Everything else (bare display names like `energetic`, removed-provider
// ids like the pre-#272 Edge `en-US-GuyNeural`, empty values) is INVALID
// and falls back. Chatterbox-nano clones serve English only, so a fallback
// never targets a clone — always a house catalog voice.
//---------------

import { cloneKeyOf, isCloneVoiceId } from '@/lib/voice-catalog';
import { isEnglishLanguage } from '@/lib/language-gate';

/** Stable warning code surfaced by the dispatch API when a persona voice
 * was swapped. Shared with the UI warning mapper (amber, never red) —
 * same convention as PERSONA_IMAGE_WARNING_CODES. */
export const VOICE_FALLBACK_WARNING_CODE = 'voice_fallback_applied';

/**
 * Why the stored voice was replaced. Sent as the PostHog `reason` property
 * and rendered by the UI mapper — values are stable machine strings, never
 * raw error text.
 */
export const VOICE_FALLBACK_REASONS = {
  /** The persona stored no voice at all. */
  VOICE_MISSING: 'voice_missing',
  /** A bare display name or an id no provider routes (Edge, 'energetic', …). */
  UNKNOWN_VOICE: 'unknown_voice',
  /** A house catalog name the served catalog no longer lists. */
  RETIRED_HOUSE_VOICE: 'retired_house_voice',
  /** The persona's clone id is not (or no longer) a ready clone of this user. */
  CLONE_UNAVAILABLE: 'clone_unavailable',
  /** A bare legacy Modal-era voice name (e.g. `en_us_female_02`) the engine
   *  can no longer route: swapped to the exact alias target. */
  LEGACY_VOICE_ALIAS: 'legacy_voice_alias',
} as const;

export type VoiceFallbackReason = (typeof VOICE_FALLBACK_REASONS)[keyof typeof VOICE_FALLBACK_REASONS];

export interface VoiceFallbackInfo {
  fromVoice: string;
  toVoice: string;
  reason: VoiceFallbackReason;
}

/**
 * What the persona's stored voice resolves to.
 * - `valid` / `clone`: the voice is used as stored (`clone` ids still need
 *   an availability check the caller performs).
 * - `fallback`: the stored voice is unusable; use `toVoice` and surface the
 *   swap (persist + warning + telemetry).
 * - `unavailable`: no valid voice exists for the persona's language — fail
 *   the request BEFORE spending render or TTS.
 */
export type VoiceResolution =
  | { kind: 'valid'; voiceId: string }
  | { kind: 'clone'; voiceId: string; key: string }
  | ({ kind: 'fallback' } & VoiceFallbackInfo)
  | { kind: 'unavailable' };

//---------------
// The house default voices, one per gender plus the gender-less default.
// Precedent: the engine's LEGACY_VOICE_ALIASES resolve the retired config
// default (`default`, `default-Female`) to kokoro_af_heart and the retired
// personal male house clone (`ryan`) to kokoro_am_michael — the same voices
// stay the defaults here, and a fallback never targets a chatterbox-nano
// clone (clones serve English only and belong to a single user).
//---------------
const DEFAULT_VOICE_FEMALE = 'chatterbox:kokoro_af_heart';
const DEFAULT_VOICE_MALE = 'chatterbox:kokoro_am_michael';
const DEFAULT_VOICE_ANY = DEFAULT_VOICE_FEMALE;

export interface ResolvePersonaVoiceOptions {
  /** Ids the engine's served catalog lists right now (GET /api/persona/voices
   *  payload). When given, house names and clones are checked against it; a
   *  missing id is retired/unavailable instead of trusted. Absent: id shape
   *  alone decides (the engine fails loudly on a name it cannot route). */
  catalogIds?: ReadonlySet<string>;
  /** Availability of the persona's clone voice (the caller's DB check).
   *  Only read when the stored id is a clone id and `catalogIds` did not
   *  already settle it. Default true (assume available). */
  cloneAvailable?: boolean;
}

/** Non-English persona: no house voice speaks that language (English-only
 *  launch, #252), so the persona's language has no valid voice. */
const NO_VOICE_FOR_LANGUAGE: VoiceResolution = { kind: 'unavailable' };

function defaultVoiceFor(gender: 'female' | 'male' | null): string {
  if (gender === 'male') return DEFAULT_VOICE_MALE;
  return DEFAULT_VOICE_ANY;
}

/**
 * The gender the stored voice id spells out, when it does. Legacy display
 * suffixes (`-Female` / `-Male`) are the only trustworthy source; arbitrary
 * bare names stay gender-unknown and fall back to the language default.
 */
function voiceGenderHint(voiceId: string): 'female' | 'male' | null {
  if (/-female$/i.test(voiceId)) return 'female';
  if (/-male$/i.test(voiceId)) return 'male';
  return null;
}

/** The bare legacy Modal-era names the engine still resolves (and only
 *  there — a BARE alias id never reaches the engine's alias map, because
 *  the alias lookup lives behind the local TTS server's routing). */
const BARE_LEGACY_ALIAS_TARGETS: Record<string, string> = {
  en_us_female_01: 'chatterbox:kokoro_af_heart',
  en_us_female_02: 'chatterbox:kokoro_af_bella',
  en_us_female_03: 'chatterbox:kokoro_af_nicole',
  en_us_female_04: 'chatterbox:kokoro_af_sarah',
  en_us_male_01: 'chatterbox:kokoro_am_michael',
  en_us_male_02: 'chatterbox:kokoro_am_adam',
  en_us_male_03: 'chatterbox:kokoro_am_eric',
  en_us_male_04: 'chatterbox:kokoro_am_liam',
};

function fallbackResolution(fromVoice: string, reason: VoiceFallbackReason, gender: 'female' | 'male' | null, language: string | null | undefined): VoiceResolution {
  if (language !== null && language !== undefined && language.trim().length > 0 && !isEnglishLanguage(language)) {
    return NO_VOICE_FOR_LANGUAGE;
  }
  return { kind: 'fallback', fromVoice, toVoice: defaultVoiceFor(gender), reason };
}

export function resolvePersonaVoice(
  voiceId: string | null | undefined,
  language: string | null | undefined,
  opts: ResolvePersonaVoiceOptions = {},
): VoiceResolution {
  const trimmed = (voiceId ?? '').trim();
  // An absent voice falls back to the persona's language default (no
  // gender is known) instead of failing at TTS with "no voice configured".
  if (trimmed.length === 0) {
    return fallbackResolution('', VOICE_FALLBACK_REASONS.VOICE_MISSING, null, language);
  }

  const lowered = trimmed.toLowerCase();
  if (lowered === 'no-voice' || lowered === 'none') {
    return { kind: 'valid', voiceId: trimmed };
  }
  if (trimmed.startsWith('elevenlabs:')) {
    const id = trimmed.slice('elevenlabs:'.length).trim();
    if (id.length > 0) return { kind: 'valid', voiceId: trimmed };
    return fallbackResolution(trimmed, VOICE_FALLBACK_REASONS.UNKNOWN_VOICE, null, language);
  }
  if (trimmed.startsWith('openrouter:')) {
    const remainder = trimmed.slice('openrouter:'.length);
    // `openrouter:<model>:<voice>` — the voice half may carry colons of its
    // own, so only the model half must be non-empty here.
    const model = remainder.split(':')[0]?.trim() ?? '';
    if (model.length > 0 && remainder.includes(':')) {
      const voice = remainder.slice(remainder.indexOf(':') + 1).trim();
      if (voice.length > 0) return { kind: 'valid', voiceId: trimmed };
    }
    return fallbackResolution(trimmed, VOICE_FALLBACK_REASONS.UNKNOWN_VOICE, null, language);
  }
  if (isCloneVoiceId(trimmed)) {
    const key = cloneKeyOf(trimmed) ?? '';
    if (opts.catalogIds !== undefined) {
      if (opts.catalogIds.has(trimmed)) return { kind: 'valid', voiceId: trimmed };
      return fallbackResolution(trimmed, VOICE_FALLBACK_REASONS.CLONE_UNAVAILABLE, null, language);
    }
    if (opts.cloneAvailable === false) {
      return fallbackResolution(trimmed, VOICE_FALLBACK_REASONS.CLONE_UNAVAILABLE, null, language);
    }
    return { kind: 'clone', voiceId: trimmed, key };
  }
  if (trimmed.startsWith('chatterbox:')) {
    const name = trimmed.slice('chatterbox:'.length).trim();
    if (name.length === 0) {
      return fallbackResolution(trimmed, VOICE_FALLBACK_REASONS.UNKNOWN_VOICE, null, language);
    }
    if (opts.catalogIds !== undefined && !opts.catalogIds.has(trimmed)) {
      return fallbackResolution(trimmed, VOICE_FALLBACK_REASONS.RETIRED_HOUSE_VOICE, voiceGenderHint(trimmed), language);
    }
    return { kind: 'valid', voiceId: trimmed };
  }

  // Bare id — no provider prefix. A legacy Modal-era name resolves to its
  // exact alias target (same gender and accent the persona picked); anything
  // else falls back to the gender default when the id spells a gender.
  const aliasTarget = BARE_LEGACY_ALIAS_TARGETS[lowered];
  if (aliasTarget !== undefined) {
    return { kind: 'fallback', fromVoice: trimmed, toVoice: aliasTarget, reason: VOICE_FALLBACK_REASONS.LEGACY_VOICE_ALIAS };
  }
  return fallbackResolution(trimmed, VOICE_FALLBACK_REASONS.UNKNOWN_VOICE, voiceGenderHint(trimmed), language);
}
