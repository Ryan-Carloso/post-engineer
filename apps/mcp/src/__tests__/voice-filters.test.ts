import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { PostEngineerClient } from '../client.js';
import { handleListVoices } from '../tools.js';
import {
  filterVoicesPayload,
  HOUSE_VOICES,
  ListVoicesSchema,
  personaVoiceField,
  PersonaVoiceIdSchema,
  resolvePersonaVoiceId,
  withResolvedPersonaVoice,
  withResolvedPersonaVoiceForUpdate,
} from '../voice-filters.js';

const UNKNOWN_VOICE = (attempt: string) =>
  `Unknown voice "${attempt}". Not a house voice and not one of your clones. Call voices (action: list) and pass the id or label from that list.`;

const PAYLOAD = {
  voices: [
    { id: 'chatterbox:kokoro_af_heart', label: 'Heart', gender: 'female', accent: 'us', kind: 'standard', description: 'American female voice, bright, high pitch.' },
    { id: 'chatterbox:kokoro_bm_george', label: 'George', gender: 'male', accent: 'gb', kind: 'standard', description: 'British male voice, mid-range pitch.' },
    { id: 'chatterbox:phonon_azgorath', label: 'Azgorath', gender: 'male', accent: null, kind: 'character', description: 'An enormous ancient demon. Cavernous, deep bass.' },
    { id: 'chatterbox:u0123_clone', gender: null, accent: null, kind: 'cloned' },
    { id: 'openrouter:cohere/wave-1:alloy', gender: null, accent: null, kind: 'standard' },
    { id: 'elevenlabs:xyz789', gender: null, accent: null, kind: 'membership' },
  ],
};

const ids = (payload: unknown): string[] =>
  (payload as { voices: { id: string }[] }).voices.map((voice) => voice.id);

function clientWith(
  listVoices: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ voices: [] }),
  listPersonas: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ personas: [] }),
) {
  return { listVoices, listPersonas } as unknown as PostEngineerClient;
}

const CATALOG = {
  voices: [
    { id: 'chatterbox:kokoro_af_heart', kind: 'standard', label: 'Heart' },
    {
      id: 'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb',
      kind: 'cloned',
      label: 'My Clone',
    },
  ],
};

describe('HOUSE_VOICES', () => {
  it('is the 65 house voices from the engine catalog', () => {
    expect(HOUSE_VOICES).toHaveLength(65);
    expect(HOUSE_VOICES[0]).toEqual({ name: 'phonon_zoey', label: 'Zoey' });
  });
});

describe('PersonaVoiceIdSchema', () => {
  it('create: requires a non-empty value (keeps "voiceId is required")', () => {
    const field = personaVoiceField('voiceId is required');
    const empty = field.safeParse('');
    expect(empty.success).toBe(false);
    if (!empty.success) {
      expect(empty.error.issues[0]?.message).toBe('voiceId is required');
    }
    expect(field.safeParse('phonon_zoey').success).toBe(true);
    expect(field.safeParse('chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb').success).toBe(true);
    expect(field.safeParse('no-voice').success).toBe(true);
    expect(field.safeParse('none').success).toBe(true);
  });

  it('update/options: optional, and a provided value must be non-empty', () => {
    expect(PersonaVoiceIdSchema.optional().safeParse(undefined).success).toBe(true);
    expect(PersonaVoiceIdSchema.safeParse('').success).toBe(false);
    expect(PersonaVoiceIdSchema.safeParse('zoey').success).toBe(true);
  });

  it('autocomplete enum carries the 65 house names AND their labels', () => {
    const field = personaVoiceField();
    // Zod 4 dropped the `_def` introspection this used to read; assert the
    // JSON Schema the MCP server actually advertises instead (the same shape
    // the index test pins for the registered tools).
    const json = z.toJSONSchema(field) as { anyOf?: Array<{ enum?: string[] }> };
    const enumValues = (json.anyOf ?? []).flatMap((part) => part.enum ?? []);
    expect(enumValues).toHaveLength(65 + 65 + 2);
    expect(enumValues).toContain('phonon_zoey');
    expect(enumValues).toContain('Zoey');
    expect(enumValues).toContain('no-voice');
    expect(enumValues).toContain('none');
  });
});

describe('resolvePersonaVoiceId', () => {
  it('passes sentinels through with zero HTTP', async () => {
    const client = clientWith();
    await expect(resolvePersonaVoiceId(client, 'no-voice')).resolves.toBe('no-voice');
    await expect(resolvePersonaVoiceId(client, 'none')).resolves.toBe('none');
    expect(client.listVoices).not.toHaveBeenCalled();
  });

  it('resolves a bare house name with zero HTTP', async () => {
    const client = clientWith();
    await expect(resolvePersonaVoiceId(client, 'phonon_zoey')).resolves.toBe('chatterbox:phonon_zoey');
    expect(client.listVoices).not.toHaveBeenCalled();
  });

  it('resolves a house label with zero HTTP', async () => {
    const client = clientWith();
    await expect(resolvePersonaVoiceId(client, 'Zoey')).resolves.toBe('chatterbox:phonon_zoey');
    expect(client.listVoices).not.toHaveBeenCalled();
  });

  it('passes `chatterbox:<name>` through with zero HTTP', async () => {
    const client = clientWith();
    await expect(resolvePersonaVoiceId(client, 'chatterbox:phonon_zoey')).resolves.toBe(
      'chatterbox:phonon_zoey',
    );
    expect(client.listVoices).not.toHaveBeenCalled();
  });

  it('matches house names and labels case-insensitively', async () => {
    const client = clientWith();
    await expect(resolvePersonaVoiceId(client, 'PHONON_ZOEY')).resolves.toBe('chatterbox:phonon_zoey');
    await expect(resolvePersonaVoiceId(client, 'zoey')).resolves.toBe('chatterbox:phonon_zoey');
    await expect(resolvePersonaVoiceId(client, 'ZOEY')).resolves.toBe('chatterbox:phonon_zoey');
    expect(client.listVoices).not.toHaveBeenCalled();
  });

  it('rejects an unknown bare voice with the exact message and never mutates', async () => {
    const listVoices = vi.fn().mockResolvedValue({ voices: [] });
    const client = clientWith(listVoices);
    await expect(resolvePersonaVoiceId(client, 'energetic')).rejects.toThrow(
      UNKNOWN_VOICE('energetic'),
    );
    await expect(resolvePersonaVoiceId(client, 'en-US-AriaNeural')).rejects.toThrow(
      UNKNOWN_VOICE('en-US-AriaNeural'),
    );
    expect(listVoices).toHaveBeenCalledTimes(2);
  });

  it('keeps the raw attempt in the thrown message', async () => {
    const listVoices = vi.fn().mockResolvedValue({ voices: [] });
    const client = clientWith(listVoices);
    const attempt = 'Bearer abc123token';
    await expect(resolvePersonaVoiceId(client, attempt)).rejects.toThrow(UNKNOWN_VOICE(attempt));
  });

  it('rejects a provider-prefixed voice that the list does not carry', async () => {
    const client = clientWith(vi.fn().mockResolvedValue(CATALOG));
    await expect(resolvePersonaVoiceId(client, 'elevenlabs:xyz')).rejects.toThrow(
      UNKNOWN_VOICE('elevenlabs:xyz'),
    );
    await expect(resolvePersonaVoiceId(client, 'openrouter:cohere:alloy')).rejects.toThrow(
      UNKNOWN_VOICE('openrouter:cohere:alloy'),
    );
  });

  it('matches a clone by full id from voices (action: list)', async () => {
    const client = clientWith(vi.fn().mockResolvedValue(CATALOG));
    await expect(
      resolvePersonaVoiceId(client, 'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb'),
    ).resolves.toBe('chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb');
  });

  it('matches a clone by key without prefix', async () => {
    const client = clientWith(vi.fn().mockResolvedValue(CATALOG));
    await expect(resolvePersonaVoiceId(client, 'uaaaaaaaaaaaa_bbbbbbbbbbbb')).resolves.toBe(
      'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb',
    );
  });

  it('matches the old `chatterbox:<key>` clone spelling to the real id', async () => {
    const client = clientWith(vi.fn().mockResolvedValue(CATALOG));
    await expect(resolvePersonaVoiceId(client, 'chatterbox:uaaaaaaaaaaaa_bbbbbbbbbbbb')).resolves.toBe(
      'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb',
    );
  });

  it('matches a clone by label (fixture-only; prod clones have label null)', async () => {
    const client = clientWith(vi.fn().mockResolvedValue(CATALOG));
    await expect(resolvePersonaVoiceId(client, 'My Clone')).resolves.toBe(
      'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb',
    );
  });

  it('never matches non-cloned entries or clone look-alikes', async () => {
    const client = clientWith(vi.fn().mockResolvedValue(CATALOG));
    await expect(resolvePersonaVoiceId(client, 'chatterbox:kokoro_af_heart')).resolves.toBe(
      'chatterbox:kokoro_af_heart',
    );
    await expect(resolvePersonaVoiceId(client, 'eaaaaaaaaaaaa_bbbbbbbbbb')).rejects.toThrow(
      UNKNOWN_VOICE('eaaaaaaaaaaaa_bbbbbbbbbb'),
    );
  });

  it('rejects an ambiguous clone label with the exact message', async () => {
    const client = clientWith(
      vi.fn().mockResolvedValue({
        voices: [
          { id: 'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb', kind: 'cloned', label: 'Twin' },
          { id: 'chatterbox_nano:ucccccccccccc_bbbbbbbbbbbb', kind: 'cloned', label: 'Twin' },
        ],
      }),
    );
    await expect(resolvePersonaVoiceId(client, 'Twin')).rejects.toThrow(
      UNKNOWN_VOICE('Twin'),
    );
  });

  it('propagates a voices (action: list) failure instead of the Unknown message', async () => {
    const client = clientWith(vi.fn().mockRejectedValue(new Error('boom: 502')));
    await expect(resolvePersonaVoiceId(client, 'energetic')).rejects.toThrow('boom: 502');
  });

  it('truncates the attempt in the message', async () => {
    const client = clientWith();
    const attempt = 'chatterbox:' + 'x'.repeat(200);
    await expect(resolvePersonaVoiceId(client, attempt)).rejects.toThrow(
      UNKNOWN_VOICE(attempt.slice(0, 80)),
    );
  });

});

describe('withResolvedPersonaVoiceForUpdate', () => {
  it('passes an unchanged legacy stored voice through without consulting voices (action: list)', async () => {
    const listVoices = vi.fn().mockResolvedValue({ voices: [] });
    const listPersonas = vi
      .fn()
      .mockResolvedValue({ personas: [{ id: 'p1', voiceId: 'energetic' }] });
    const client = clientWith(listVoices, listPersonas);
    const input = { personaId: 'p1', voiceId: 'energetic' };
    await expect(
      withResolvedPersonaVoiceForUpdate(client, input),
    ).resolves.toBe(input);
    expect(listVoices).not.toHaveBeenCalled();
  });

  it('still resolves a changed voice after reading the stored one', async () => {
    const listPersonas = vi
      .fn()
      .mockResolvedValue({ personas: [{ id: 'p1', voiceId: 'chatterbox:kokoro_af_heart' }] });
    const client = clientWith(vi.fn().mockResolvedValue({ voices: [] }), listPersonas);
    await expect(
      withResolvedPersonaVoiceForUpdate(
        client,
        { personaId: 'p1', voiceId: 'phonon_zoey' }
      ),
    ).resolves.toEqual({ personaId: 'p1', voiceId: 'chatterbox:phonon_zoey' });
    expect(listPersonas).toHaveBeenCalledTimes(1);
  });

  it('skips the persona list entirely when no voiceId was sent', async () => {
    const listPersonas = vi.fn();
    const client = clientWith(vi.fn(), listPersonas);
    const input = { personaId: 'p1' };
    await expect(
      withResolvedPersonaVoiceForUpdate(client, input),
    ).resolves.toBe(input);
    expect(listPersonas).not.toHaveBeenCalled();
  });

  it('falls back to normal resolution when the persona list fails', async () => {
    const listVoices = vi.fn().mockResolvedValue({ voices: [] });
    const listPersonas = vi.fn().mockRejectedValue(new Error('list down'));
    const client = clientWith(listVoices, listPersonas);
    await expect(
      withResolvedPersonaVoiceForUpdate(
        client,
        { personaId: 'p1', voiceId: 'energetic' }
      ),
    ).rejects.toThrow(UNKNOWN_VOICE('energetic'));
    expect(listVoices).toHaveBeenCalledTimes(1);
  });
});

describe('withResolvedPersonaVoice', () => {
  it('routes a house name to its id inside the passed input', async () => {
    const client = clientWith();
    await expect(
      withResolvedPersonaVoice(client, { voiceId: 'phonon_zoey' }),
    ).resolves.toEqual({ voiceId: 'chatterbox:phonon_zoey' });
    expect(client.listVoices).not.toHaveBeenCalled();
  });

  it('leaves inputs without a voiceId untouched (update skips)', async () => {
    const client = clientWith();
    // Typed with the optional voiceId: a bare { personaId } fails the
    // weak-type check on withResolvedPersonaVoice's { voiceId?: string }
    // constraint (TS2559), even though the runtime input has no voice.
    const input: { personaId: string; voiceId?: string } = { personaId: 'p1' };
    await expect(withResolvedPersonaVoice(client, input)).resolves.toBe(input);
    expect(client.listVoices).not.toHaveBeenCalled();
  });
});

describe('filterVoicesPayload', () => {
  it('always drops provider-prefixed ids (openrouter:, elevenlabs:) — the picker is house voices + clones only', () => {
    const filtered = filterVoicesPayload(PAYLOAD, {});
    expect(ids(filtered)).toEqual([
      'chatterbox:kokoro_af_heart',
      'chatterbox:kokoro_bm_george',
      'chatterbox:phonon_azgorath',
      'chatterbox:u0123_clone',
    ]);
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
