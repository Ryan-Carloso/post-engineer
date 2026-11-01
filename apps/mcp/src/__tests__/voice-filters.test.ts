import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockTrackEvent = vi.hoisted(() => vi.fn());
vi.mock('../analytics.js', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  withTracking: (toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => {
    mockTrackEvent('mcp_tool_called', { toolName });
    return handler(args);
  },
}));

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
} from '../voice-filters.js';

const UNKNOWN_VOICE = (attempt: string) =>
  `Unknown voice "${attempt}". Not a house voice and not one of your clones. Call list_voices and pass the id or label from that list.`;

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

function clientWith(listVoices: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ voices: [] })) {
  return { listVoices } as unknown as PostEngineerClient;
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
    const inner = (field as unknown as { _def: { schema: unknown } })._def.schema as {
      _def: { options: { _def: { values: string[] } }[] };
    };
    const enumValues = inner._def.options[0]._def.values;
    expect(enumValues).toHaveLength(65 + 65 + 2);
    expect(enumValues).toContain('phonon_zoey');
    expect(enumValues).toContain('Zoey');
    expect(enumValues).toContain('no-voice');
    expect(enumValues).toContain('none');
  });
});

describe('resolvePersonaVoiceId', () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
  });

  it('passes sentinels through with zero HTTP', async () => {
    const client = clientWith();
    await expect(resolvePersonaVoiceId(client, 'no-voice', 'update_persona')).resolves.toBe('no-voice');
    await expect(resolvePersonaVoiceId(client, 'none', 'update_persona')).resolves.toBe('none');
    expect(client.listVoices).not.toHaveBeenCalled();
    expect(mockTrackEvent).not.toHaveBeenCalledWith('server_warning', expect.anything());
  });

  it('resolves a bare house name with zero HTTP', async () => {
    const client = clientWith();
    await expect(resolvePersonaVoiceId(client, 'phonon_zoey', 'create_persona')).resolves.toBe('chatterbox:phonon_zoey');
    expect(client.listVoices).not.toHaveBeenCalled();
  });

  it('resolves a house label with zero HTTP', async () => {
    const client = clientWith();
    await expect(resolvePersonaVoiceId(client, 'Zoey', 'create_persona')).resolves.toBe('chatterbox:phonon_zoey');
    expect(client.listVoices).not.toHaveBeenCalled();
  });

  it('passes `chatterbox:<name>` through with zero HTTP', async () => {
    const client = clientWith();
    await expect(resolvePersonaVoiceId(client, 'chatterbox:phonon_zoey', 'create_persona')).resolves.toBe(
      'chatterbox:phonon_zoey',
    );
    expect(client.listVoices).not.toHaveBeenCalled();
  });

  it('matches house names and labels case-insensitively', async () => {
    const client = clientWith();
    await expect(resolvePersonaVoiceId(client, 'PHONON_ZOEY', 'create_persona')).resolves.toBe('chatterbox:phonon_zoey');
    await expect(resolvePersonaVoiceId(client, 'zoey', 'create_persona')).resolves.toBe('chatterbox:phonon_zoey');
    await expect(resolvePersonaVoiceId(client, 'ZOEY', 'create_persona')).resolves.toBe('chatterbox:phonon_zoey');
    expect(client.listVoices).not.toHaveBeenCalled();
  });

  it('rejects an unknown bare voice with the exact message, warns PostHog, and never mutates', async () => {
    const listVoices = vi.fn().mockResolvedValue({ voices: [] });
    const client = clientWith(listVoices);
    await expect(resolvePersonaVoiceId(client, 'energetic', 'update_persona')).rejects.toThrow(
      UNKNOWN_VOICE('energetic'),
    );
    await expect(resolvePersonaVoiceId(client, 'en-US-AriaNeural', 'update_persona')).rejects.toThrow(
      UNKNOWN_VOICE('en-US-AriaNeural'),
    );
    expect(listVoices).toHaveBeenCalledTimes(2);
    expect(mockTrackEvent).toHaveBeenCalledWith('server_warning', {
      code: 'UNKNOWN_VOICE',
      tool: 'update_persona',
      voice: 'en-US-AriaNeural',
    });
  });

  it('rejects a provider-prefixed voice that the list does not carry', async () => {
    const client = clientWith(vi.fn().mockResolvedValue(CATALOG));
    await expect(resolvePersonaVoiceId(client, 'elevenlabs:xyz', 'create_persona')).rejects.toThrow(
      UNKNOWN_VOICE('elevenlabs:xyz'),
    );
    await expect(resolvePersonaVoiceId(client, 'openrouter:cohere:alloy', 'create_persona')).rejects.toThrow(
      UNKNOWN_VOICE('openrouter:cohere:alloy'),
    );
  });

  it('matches a clone by full id from list_voices', async () => {
    const client = clientWith(vi.fn().mockResolvedValue(CATALOG));
    await expect(
      resolvePersonaVoiceId(client, 'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb', 'update_persona'),
    ).resolves.toBe('chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb');
  });

  it('matches a clone by key without prefix', async () => {
    const client = clientWith(vi.fn().mockResolvedValue(CATALOG));
    await expect(resolvePersonaVoiceId(client, 'uaaaaaaaaaaaa_bbbbbbbbbbbb', 'update_persona')).resolves.toBe(
      'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb',
    );
  });

  it('matches the old `chatterbox:<key>` clone spelling to the real id', async () => {
    const client = clientWith(vi.fn().mockResolvedValue(CATALOG));
    await expect(resolvePersonaVoiceId(client, 'chatterbox:uaaaaaaaaaaaa_bbbbbbbbbbbb', 'update_persona')).resolves.toBe(
      'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb',
    );
  });

  it('matches a clone by label (fixture-only; prod clones have label null)', async () => {
    const client = clientWith(vi.fn().mockResolvedValue(CATALOG));
    await expect(resolvePersonaVoiceId(client, 'My Clone', 'update_persona')).resolves.toBe(
      'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb',
    );
  });

  it('never matches non-cloned entries or clone look-alikes', async () => {
    const client = clientWith(vi.fn().mockResolvedValue(CATALOG));
    await expect(resolvePersonaVoiceId(client, 'chatterbox:kokoro_af_heart', 'update_persona')).resolves.toBe(
      'chatterbox:kokoro_af_heart',
    );
    await expect(resolvePersonaVoiceId(client, 'eaaaaaaaaaaaa_bbbbbbbbbb', 'update_persona')).rejects.toThrow(
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
    await expect(resolvePersonaVoiceId(client, 'Twin', 'update_persona')).rejects.toThrow(
      UNKNOWN_VOICE('Twin'),
    );
  });

  it('propagates a list_voices failure instead of the Unknown message (no server_warning)', async () => {
    const client = clientWith(vi.fn().mockRejectedValue(new Error('boom: 502')));
    await expect(resolvePersonaVoiceId(client, 'energetic', 'update_persona')).rejects.toThrow('boom: 502');
    expect(mockTrackEvent).not.toHaveBeenCalledWith('server_warning', expect.anything());
  });

  it('truncates the attempt in the message and the telemetry property', async () => {
    const client = clientWith();
    const attempt = 'chatterbox:' + 'x'.repeat(200);
    await expect(resolvePersonaVoiceId(client, attempt, 'create_persona')).rejects.toThrow(
      UNKNOWN_VOICE(attempt.slice(0, 80)),
    );
    expect(mockTrackEvent).toHaveBeenCalledWith('server_warning', {
      code: 'UNKNOWN_VOICE',
      tool: 'create_persona',
      voice: attempt.slice(0, 80),
    });
  });

  it('never breaks when telemetry itself throws', async () => {
    mockTrackEvent.mockImplementation(() => {
      throw new Error('posthog down');
    });
    const client = clientWith();
    await expect(resolvePersonaVoiceId(client, 'energetic', 'update_persona')).rejects.toThrow(
      UNKNOWN_VOICE('energetic'),
    );
    mockTrackEvent.mockImplementation(() => undefined);
  });

  it('truncates the voice property to 80 chars in the telemetry', async () => {
    const attempt = 'chatterbox:' + 'x'.repeat(200);
    const client = clientWith();
    await expect(resolvePersonaVoiceId(client, attempt, 'update_persona')).rejects.toThrow(
      UNKNOWN_VOICE(attempt.slice(0, 80)),
    );
    expect(mockTrackEvent).toHaveBeenCalledWith('server_warning', {
      code: 'UNKNOWN_VOICE',
      tool: 'update_persona',
      voice: attempt.slice(0, 80),
    });
  });
});

describe('withResolvedPersonaVoice', () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
  });

  it('routes a house name to its id inside the passed input', async () => {
    const client = clientWith();
    await expect(
      withResolvedPersonaVoice(client, { voiceId: 'phonon_zoey' }, 'create_persona'),
    ).resolves.toEqual({ voiceId: 'chatterbox:phonon_zoey' });
    expect(client.listVoices).not.toHaveBeenCalled();
  });

  it('leaves inputs without a voiceId untouched (update skips)', async () => {
    const client = clientWith();
    // Typed with the optional voiceId: a bare { personaId } fails the
    // weak-type check on withResolvedPersonaVoice's { voiceId?: string }
    // constraint (TS2559), even though the runtime input has no voice.
    const input: { personaId: string; voiceId?: string } = { personaId: 'p1' };
    await expect(withResolvedPersonaVoice(client, input, 'update_persona')).resolves.toBe(input);
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
