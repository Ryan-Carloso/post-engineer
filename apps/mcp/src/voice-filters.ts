import { z } from 'zod';

//---------------
// list_voices filters — mirror the web picker: gender (female/male), origin
// (us/gb/character) and a free-text search. Characters have no accent but
// keep a gender, so the gender filter applies to them too. Omitted = no
// filter. Entries come from GET /api/persona/voices: { id, label, provider,
// gender, accent, kind, description }. Agents cannot listen to samples, so
// the description is how they choose.
//---------------

export const ListVoicesShape = {
  gender: z.enum(['female', 'male']).optional().describe('Only voices of this gender'),
  origin: z
    .enum(['us', 'gb', 'character'])
    .optional()
    .describe('us = American English, gb = British English, character = character voices'),
  search: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe('Words to match in the voice name or description, e.g. "deep calm", "pirate", "british warm"'),
};

export const ListVoicesSchema = z.object(ListVoicesShape);

export type ListVoicesArgs = z.infer<typeof ListVoicesSchema>;

interface VoiceEntry {
  id: unknown;
  label?: unknown;
  description?: unknown;
  gender: unknown;
  accent: unknown;
  kind: unknown;
}

// Same rule as the web picker (apps/web/lib/voice-catalog.ts searchVoices):
// every query word must start a word of the voice's name, description, id or
// tag words, case- and accent-insensitive — so "male" never matches "female".
const ACCENT_WORDS: Record<string, string> = { us: 'american usa us', gb: 'british uk england' };
const GENDER_WORDS: Record<string, string> = { female: 'female woman', male: 'male man' };

function words(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
}

function matchesSearch(voice: VoiceEntry, query: string): boolean {
  const text = [voice.label, voice.description, voice.id, voice.kind]
    .filter((part): part is string => typeof part === 'string')
    .join(' ');
  const tags = `${typeof voice.accent === 'string' ? (ACCENT_WORDS[voice.accent] ?? '') : ''} ${
    typeof voice.gender === 'string' ? (GENDER_WORDS[voice.gender] ?? '') : ''
  }`;
  const voiceWords = words(`${text} ${tags}`);
  return words(query).every((word) => voiceWords.some((voiceWord) => voiceWord.startsWith(word)));
}

function isVoiceEntry(value: unknown): value is VoiceEntry {
  return typeof value === 'object' && value !== null && 'id' in value && 'kind' in value;
}

export function filterVoicesPayload(payload: unknown, args: ListVoicesArgs): unknown {
  if (args.gender === undefined && args.origin === undefined && args.search === undefined) {
    return payload;
  }
  if (typeof payload !== 'object' || payload === null || !('voices' in payload) || !Array.isArray(payload.voices)) {
    throw new Error('Invalid voices response: expected { voices: [...] }');
  }
  const voices = payload.voices.filter((voice: unknown) => {
    if (!isVoiceEntry(voice)) {
      throw new Error('Invalid voices response: voice entry without id/kind');
    }
    if (args.gender !== undefined && voice.gender !== args.gender) {
      return false;
    }
    if (args.search !== undefined && !matchesSearch(voice, args.search)) {
      return false;
    }
    if (args.origin === undefined) {
      return true;
    }
    if (args.origin === 'character') {
      return voice.kind === 'character';
    }
    return voice.kind === 'standard' && voice.accent === args.origin;
  });
  return { ...payload, voices };
}
