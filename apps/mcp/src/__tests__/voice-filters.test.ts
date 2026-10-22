import { describe, expect, it, vi } from 'vitest';

import type { PostEngineerClient } from '../client.js';
import { handleListVoices } from '../tools.js';
import { filterVoicesPayload, ListVoicesSchema } from '../voice-filters.js';

const PAYLOAD = {
  voices: [
    { id: 'chatterbox:kokoro_af_heart', gender: 'female', accent: 'us', kind: 'standard' },
    { id: 'chatterbox:kokoro_bm_george', gender: 'male', accent: 'gb', kind: 'standard' },
    { id: 'chatterbox:phonon_azgorath', gender: 'male', accent: null, kind: 'character' },
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

  it('fails loudly on a malformed payload when filtering', () => {
    expect(() => filterVoicesPayload({}, { gender: 'male' })).toThrow('Invalid voices response');
    expect(() => filterVoicesPayload({ voices: [{}] }, { gender: 'male' })).toThrow('Invalid voices response');
  });

  it('rejects unknown filter values at parse time', () => {
    expect(ListVoicesSchema.safeParse({ gender: 'other' }).success).toBe(false);
    expect(ListVoicesSchema.safeParse({ origin: 'au' }).success).toBe(false);
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
