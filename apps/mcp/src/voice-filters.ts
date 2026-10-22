import { z } from 'zod';

//---------------
// list_voices filters — mirror the web picker: gender (female/male) and
// origin (us/gb/character). Characters have no accent but keep a gender, so
// the gender filter applies to them too. Omitted = no filter. Entries come
// from GET /api/persona/voices: { id, label, provider, gender, accent, kind }.
//---------------

export const ListVoicesShape = {
  gender: z.enum(['female', 'male']).optional().describe('Only voices of this gender'),
  origin: z
    .enum(['us', 'gb', 'character'])
    .optional()
    .describe('us = American English, gb = British English, character = character voices'),
};

export const ListVoicesSchema = z.object(ListVoicesShape);

export type ListVoicesArgs = z.infer<typeof ListVoicesSchema>;

interface VoiceEntry {
  gender: unknown;
  accent: unknown;
  kind: unknown;
}

function isVoiceEntry(value: unknown): value is VoiceEntry {
  return typeof value === 'object' && value !== null && 'id' in value && 'kind' in value;
}

export function filterVoicesPayload(payload: unknown, args: ListVoicesArgs): unknown {
  if (args.gender === undefined && args.origin === undefined) {
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
