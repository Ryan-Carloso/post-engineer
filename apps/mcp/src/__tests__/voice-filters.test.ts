import { describe, expect, it, vi } from 'vitest';

import type { PostEngineerClient } from '../client.js';
import { handleListVoices } from '../tools.js';
import { filterVoicesPayload, ListVoicesSchema } from '../voice-filters.js';

const PAYLOAD = {
  voices: [
    { id: 'chatterbox:kokoro_af_heart', label: 'Heart', gender: 'female', accent: 'us', kind: 'standard', description: 'American female voice, bright, high pitch.' },
    { id: 'chatterbox:kokoro_bm_george', label: 'George', gender: 'male', accent: 'gb', kind: 'standard', description: 'British male voice, mid-range pitch.' },
    { id: 'chatterbox:phonon_azgorath', label: 'Azgorath', gender: 'male', accent: null, kind: 'character', description: 'An enormous ancient demon. Cavernous, deep bass.' },
    { id: 'chatterbox:u0123_clone', gender: null, accent: null, kind: 'cloned' },
  ],
};

const ids = (payload: unknown): string[] =>
  (payload as { voices: { id: string }[] }).voices.map((voice) => voice.id);

describe('filterVoicesPayload', () => {
  it('returns the payload untouched without filters', () => {
    expect(filterVoicesPayload(PAYLOAD, {})).toBe(PAYLOAD);
  });

  it('filters by gender, origin, and both', () => {
    expect(ids(filterVoicesPayload(PAYLOAD, { gender: 'male' }))).toEqual([
      'chatterbox:kokoro_bm_george',
      'chatterbox:phonon_azgorath',
    ]);
    expect(ids(filterVoicesPayload(PAYLOAD, { origin: 'us' }))).toEqual(['chatterbox:kokoro_af_heart']);
    expect(ids(filterVoicesPayload(PAYLOAD, { origin: 'character', gender: 'male' }))).toEqual([
      'chatterbox:phonon_azgorath',
    ]);
    expect(ids(filterVoicesPayload(PAYLOAD, { origin: 'character', gender: 'female' }))).toEqual([]);
  });

  it('search matches word prefixes in name, description and tags', () => {
    expect(ids(filterVoicesPayload(PAYLOAD, { search: 'dem' }))).toEqual(['chatterbox:phonon_azgorath']);
    expect(ids(filterVoicesPayload(PAYLOAD, { search: 'British man' }))).toEqual(['chatterbox:kokoro_bm_george']);
    expect(ids(filterVoicesPayload(PAYLOAD, { search: 'male', origin: 'us' }))).toEqual([]);
    expect(ids(filterVoicesPayload(PAYLOAD, { search: 'heart' }))).toEqual(['chatterbox:kokoro_af_heart']);
  });

  it('fails loudly on a malformed payload when filtering', () => {
    expect(() => filterVoicesPayload({}, { gender: 'male' })).toThrow('Invalid voices response');
    expect(() => filterVoicesPayload({ voices: [{}] }, { gender: 'male' })).toThrow('Invalid voices response');
  });

  it('rejects unknown filter values at parse time', () => {
    expect(ListVoicesSchema.safeParse({ gender: 'other' }).success).toBe(false);
    expect(ListVoicesSchema.safeParse({ origin: 'au' }).success).toBe(false);
    expect(ListVoicesSchema.safeParse({ search: '   ' }).success).toBe(false);
    expect(ListVoicesSchema.safeParse({ search: 'x'.repeat(101) }).success).toBe(false);
  });
});

describe('handleListVoices', () => {
  it('applies the filters to the client response', async () => {
    const client = { listVoices: vi.fn().mockResolvedValue(PAYLOAD) } as unknown as PostEngineerClient;
    const result = await handleListVoices(client, { origin: 'gb' });
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(text).toContain('kokoro_bm_george');
    expect(text).not.toContain('kokoro_af_heart');
  });
});
