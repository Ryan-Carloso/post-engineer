//---------------
// Voice catalog entries as the engine serves them (GET /api/v1/personas/voices):
// house voices (Phonon + Kokoro) carry gender/accent/kind for the picker
// filters; OpenRouter voices carry none; the caller's clones are kind
// "cloned". Shared by the /api/persona/voices proxy and the client fetcher so
// both validate the same shape.
//---------------

export const VOICE_GENDERS = ['female', 'male'] as const;
export const VOICE_ACCENTS = ['us', 'gb'] as const;
export const VOICE_KINDS = ['standard', 'character', 'cloned'] as const;

export type VoiceGender = (typeof VOICE_GENDERS)[number];
export type VoiceAccent = (typeof VOICE_ACCENTS)[number];
export type VoiceKind = (typeof VOICE_KINDS)[number];

export interface VoiceOption {
  id: string;
  label: string | null;
  provider: string;
  gender: VoiceGender | null;
  accent: VoiceAccent | null;
  kind: VoiceKind;
  /** English text about how the voice sounds; null for OpenRouter and clones. */
  description: string | null;
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.some((candidate) => candidate === value);
}

function isNullOr<T>(value: unknown, guard: (inner: unknown) => inner is T): value is T | null {
  return value === null || guard(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isVoiceOption(value: unknown): value is VoiceOption {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record: Record<string, unknown> = { ...value };
  return (
    typeof record.id === 'string' &&
    record.id !== '' &&
    isNullOr(record.label, isString) &&
    typeof record.provider === 'string' &&
    isNullOr(record.gender, (inner): inner is VoiceGender => isOneOf(VOICE_GENDERS, inner)) &&
    isNullOr(record.accent, (inner): inner is VoiceAccent => isOneOf(VOICE_ACCENTS, inner)) &&
    isOneOf(VOICE_KINDS, record.kind) &&
    isNullOr(record.description, isString)
  );
}

export function toVoiceOption(voice: VoiceOption): VoiceOption {
  return {
    id: voice.id,
    label: voice.label,
    provider: voice.provider,
    gender: voice.gender,
    accent: voice.accent,
    kind: voice.kind,
    description: voice.description,
  };
}

//---------------
// Picker filters. Gender: all / female / male. Origin: all / US / UK /
// characters. Characters are their own origin (no accent) but keep a gender,
// so the gender filter applies to them too. Clones never show in the house
// grid — they live in the "clone my voice" tab.
//---------------

export const GENDER_FILTERS = ['all', 'female', 'male'] as const;
export const ORIGIN_FILTERS = ['all', 'us', 'gb', 'character'] as const;

export type GenderFilter = (typeof GENDER_FILTERS)[number];
export type OriginFilter = (typeof ORIGIN_FILTERS)[number];

export function filterHouseVoices(
  voices: readonly VoiceOption[],
  gender: GenderFilter,
  origin: OriginFilter,
): VoiceOption[] {
  return voices.filter((voice) => {
    if (voice.kind === 'cloned') {
      return false;
    }
    if (gender !== 'all' && voice.gender !== gender) {
      return false;
    }
    if (origin === 'all') {
      return true;
    }
    if (origin === 'character') {
      return voice.kind === 'character';
    }
    return voice.kind === 'standard' && voice.accent === origin;
  });
}

//---------------
// searchVoices — case- and accent-insensitive match on every word of the
// query against the voice's label, description, id and tag words ("deep
// british" finds a British voice described as deep). Each query word must
// START a word of the voice text, so typing "pir" finds "pirate" while "male"
// does not match "female". An empty query keeps every voice.
//---------------
// Searchable words for the structured tags, so "british woman" or
// "character" match even when the description never says so.
const ACCENT_SEARCH_WORDS: Record<VoiceAccent, string> = { us: 'american usa us', gb: 'british uk england' };
const GENDER_SEARCH_WORDS: Record<VoiceGender, string> = { female: 'female woman', male: 'male man' };

function normalizeSearchText(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function searchVoices(voices: readonly VoiceOption[], query: string): VoiceOption[] {
  const words = normalizeSearchText(query).split(/[^a-z0-9]+/).filter((word) => word !== '');
  if (words.length === 0) {
    return [...voices];
  }
  return voices.filter((voice) => {
    const tags = [
      voice.accent === null ? '' : ACCENT_SEARCH_WORDS[voice.accent],
      voice.gender === null ? '' : GENDER_SEARCH_WORDS[voice.gender],
      voice.kind,
    ].join(' ');
    const voiceWords = normalizeSearchText(`${voice.label ?? ''} ${voice.description ?? ''} ${voice.id} ${tags}`)
      .split(/[^a-z0-9]+/)
      .filter((word) => word !== '');
    return words.every((word) => voiceWords.some((voiceWord) => voiceWord.startsWith(word)));
  });
}

//---------------
// voiceSampleName — house voice samples live at /voice-samples/<name>.mp3,
// keyed by the catalog name without the `chatterbox:` routing prefix (a colon
// is not a portable file name). Only catalog voices have a sample.
//---------------
export function voiceSampleName(voice: VoiceOption): string | null {
  if (voice.kind === 'cloned' || voice.provider === 'openrouter') {
    return null;
  }
  return voice.id.startsWith('chatterbox:') ? voice.id.slice('chatterbox:'.length) : null;
}
