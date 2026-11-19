import { isEnglishLanguage } from '@/lib/language-gate';
import { cloneKeyOf, isCloneVoiceId } from '@/lib/voice-catalog';

function catalogContainsClone(catalogIds: ReadonlySet<string>): boolean {
  for (const id of catalogIds) {
    if (isCloneVoiceId(id)) return true;
  }
  return false;
}

function catalogListsCloneKey(catalogIds: ReadonlySet<string>, voiceId: string): boolean {
  const key = cloneKeyOf(voiceId);
  if (key === null || key.length === 0) return false;
  for (const id of catalogIds) {
    if (isCloneVoiceId(id) && cloneKeyOf(id) === key) return true;
  }
  return false;
}

export const VOICE_FALLBACK_WARNING_CODE = 'voice_fallback_applied';

export const VOICE_FALLBACK_REASONS = {
  VOICE_MISSING: 'voice_missing',
  UNKNOWN_VOICE: 'unknown_voice',
  RETIRED_HOUSE_VOICE: 'retired_house_voice',
  CLONE_UNAVAILABLE: 'clone_unavailable',
  LEGACY_VOICE_ALIAS: 'legacy_voice_alias',
} as const;

export type VoiceFallbackReason = (typeof VOICE_FALLBACK_REASONS)[keyof typeof VOICE_FALLBACK_REASONS];

export interface VoiceFallbackInfo {
  fromVoice: string;
  toVoice: string;
  reason: VoiceFallbackReason;
}

export type VoiceResolution =
  | { kind: 'valid'; voiceId: string }
  | { kind: 'clone'; voiceId: string; key: string }
  | ({ kind: 'fallback' } & VoiceFallbackInfo)
  | { kind: 'unavailable' };

const DEFAULT_VOICE_FEMALE = 'chatterbox:kokoro_af_heart';
const DEFAULT_VOICE_MALE = 'chatterbox:kokoro_am_michael';
const DEFAULT_VOICE_ANY = DEFAULT_VOICE_FEMALE;

export interface ResolvePersonaVoiceOptions {
  catalogIds?: ReadonlySet<string>;
  cloneAvailable?: boolean;
}

const NO_VOICE_FOR_LANGUAGE: VoiceResolution = { kind: 'unavailable' };

function defaultVoiceFor(gender: 'female' | 'male' | null): string {
  if (gender === 'male') return DEFAULT_VOICE_MALE;
  return DEFAULT_VOICE_ANY;
}

function voiceGenderHint(voiceId: string): 'female' | 'male' | null {
  if (/(?:^|[-_\s])female(?:[-_\s]|$)/i.test(voiceId)) return 'female';
  if (/(?:^|[-_\s])male(?:[-_\s]|$)/i.test(voiceId)) return 'male';
  return null;
}

const BARE_LEGACY_ALIAS_TARGETS: Record<string, string> = {
  default: 'chatterbox:kokoro_af_heart',
  ryan: 'chatterbox:kokoro_am_michael',
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
  const catalogIds = opts.catalogIds;
  const hasClones = catalogIds !== undefined && catalogContainsClone(catalogIds);
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
    const model = remainder.split(':')[0]?.trim() ?? '';
    if (model.length > 0 && remainder.includes(':')) {
      const voice = remainder.slice(remainder.indexOf(':') + 1).trim();
      if (voice.length > 0) return { kind: 'valid', voiceId: trimmed };
    }
    return fallbackResolution(trimmed, VOICE_FALLBACK_REASONS.UNKNOWN_VOICE, null, language);
  }
  if (isCloneVoiceId(trimmed)) {
    const key = cloneKeyOf(trimmed) ?? '';
    if (catalogIds !== undefined) {
      if (catalogListsCloneKey(catalogIds, trimmed)) {
        return { kind: 'valid', voiceId: trimmed };
      }
      if (hasClones) {
        return fallbackResolution(trimmed, VOICE_FALLBACK_REASONS.CLONE_UNAVAILABLE, null, language);
      }
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
    const routableId = `chatterbox:${name.replace(/-(?:Female|Male)$/, '')}`;
    if (catalogIds !== undefined && !catalogIds.has(trimmed) && !catalogIds.has(routableId)) {
      return fallbackResolution(trimmed, VOICE_FALLBACK_REASONS.RETIRED_HOUSE_VOICE, voiceGenderHint(trimmed), language);
    }
    return { kind: 'valid', voiceId: trimmed };
  }

  const aliasTarget = BARE_LEGACY_ALIAS_TARGETS[lowered];
  if (aliasTarget !== undefined) {
    if (language !== null && language !== undefined && language.trim().length > 0 && !isEnglishLanguage(language)) {
      return NO_VOICE_FOR_LANGUAGE;
    }
    return { kind: 'fallback', fromVoice: trimmed, toVoice: aliasTarget, reason: VOICE_FALLBACK_REASONS.LEGACY_VOICE_ALIAS };
  }
  return fallbackResolution(trimmed, VOICE_FALLBACK_REASONS.UNKNOWN_VOICE, voiceGenderHint(trimmed), language);
}
