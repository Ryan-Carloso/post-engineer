import { describe, expect, it, vi } from 'vitest';
import type { PostEngineerClient } from '../client.js';
import {
  HOUSE_VOICES,
  personaVoiceField,
  resolvePersonaVoiceId,
} from '../persona-voice.js';

const UNKNOWN_MESSAGE =
  'Unknown voice. Call list_voices and pass the id or label from that list (house voices and your clones).';

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

describe('personaVoiceField schema', () => {
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

  it('update: optional, and a provided value must be non-empty', () => {
    const field = personaVoiceField().optional();
    expect(field.safeParse(undefined).success).toBe(true);
    expect(field.safeParse('').success).toBe(false);
    expect(field.safeParse('zoey').success).toBe(true);
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

  it('rejects an unknown bare voice with the exact message (consults the voice list first)', async () => {
    const listVoices = vi.fn().mockResolvedValue({ voices: [] });
    const client = clientWith(listVoices);
    await expect(resolvePersonaVoiceId(client, 'energetic')).rejects.toThrow(UNKNOWN_MESSAGE);
    await expect(resolvePersonaVoiceId(client, 'en-US-AriaNeural')).rejects.toThrow(UNKNOWN_MESSAGE);
    expect(listVoices).toHaveBeenCalledTimes(2);
  });

  it('rejects a provider-prefixed voice that list does not carry', async () => {
    const client = clientWith(vi.fn().mockResolvedValue(CATALOG));
    await expect(resolvePersonaVoiceId(client, 'elevenlabs:xyz')).rejects.toThrow(UNKNOWN_MESSAGE);
    await expect(resolvePersonaVoiceId(client, 'openrouter:cohere:alloy')).rejects.toThrow(
      UNKNOWN_MESSAGE,
    );
  });

  it('matches a clone by full id from list_voices', async () => {
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
      UNKNOWN_MESSAGE,
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
    await expect(resolvePersonaVoiceId(client, 'Twin')).rejects.toThrow(UNKNOWN_MESSAGE);
  });

  it('propagates a list_voices failure instead of the Unknown message', async () => {
    const client = clientWith(vi.fn().mockRejectedValue(new Error('boom: 502')));
    await expect(resolvePersonaVoiceId(client, 'energetic')).rejects.toThrow('boom: 502');
  });
});
