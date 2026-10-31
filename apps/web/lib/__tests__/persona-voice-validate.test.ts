import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/voice-catalog-fetch', () => ({
  fetchPersonaVoiceCatalogIds: vi.fn(async () => undefined),
}));

import { fetchPersonaVoiceCatalogIds } from '@/lib/voice-catalog-fetch';
import {
  applyPersonaVoicePatch,
  cloneVoiceAvailable,
  validatePersonaVoiceInput,
} from '@/lib/persona-voice-validate';

const USER_ID = 'user-uuid-1';

const unknownMessage = (id: string) =>
  `Unknown voice "${id}": pick an id or label from GET /api/persona/voices (house voices and your clones).`;

function supabaseMock(readyClones: number = 0) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              limit: vi.fn(async () => ({
                data: Array.from({ length: readyClones }, () => ({ engine_voice_key: 'x' })),
                error: null,
              })),
            })),
          })),
        })),
      })),
    })),
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  vi.mocked(fetchPersonaVoiceCatalogIds).mockClear().mockResolvedValue(undefined);
});

describe('validatePersonaVoiceInput', () => {
  it('requires a voice on create', async () => {
    await expect(validatePersonaVoiceInput(supabaseMock(), USER_ID, null)).resolves.toBe(
      'Provide voiceId.',
    );
    await expect(validatePersonaVoiceInput(supabaseMock(), USER_ID, '')).resolves.toBe(
      'Provide voiceId.',
    );
    await expect(validatePersonaVoiceInput(supabaseMock(), USER_ID, '  ')).resolves.toBe(
      'Provide voiceId.',
    );
  });

  it('accepts the sentinels and provider ids the engine routes itself', async () => {
    for (const voiceId of ['no-voice', 'none', 'elevenlabs:xyz', 'openrouter:cohere/wave-1:alloy']) {
      await expect(validatePersonaVoiceInput(supabaseMock(), USER_ID, voiceId)).resolves.toBeNull();
    }
    expect(fetchPersonaVoiceCatalogIds).not.toHaveBeenCalled();
  });

  it('accepts a house id the served catalog carries', async () => {
    vi.mocked(fetchPersonaVoiceCatalogIds).mockResolvedValue(
      new Set(['chatterbox:kokoro_af_heart', 'chatterbox:phonon_zoey']),
    );
    await expect(
      validatePersonaVoiceInput(supabaseMock(), USER_ID, 'chatterbox:kokoro_af_heart'),
    ).resolves.toBeNull();
    expect(fetchPersonaVoiceCatalogIds).toHaveBeenCalledWith(USER_ID);
  });

  it('accepts a house id shape-only when the catalog is down (same as dispatch)', async () => {
    await expect(
      validatePersonaVoiceInput(supabaseMock(), USER_ID, 'chatterbox:kokoro_af_heart'),
    ).resolves.toBeNull();
  });

  it('rejects a house voice the served catalog no longer carries', async () => {
    vi.mocked(fetchPersonaVoiceCatalogIds).mockResolvedValue(
      new Set(['chatterbox:phonon_zoey']),
    );
    await expect(
      validatePersonaVoiceInput(supabaseMock(), USER_ID, 'chatterbox:kokoro_af_heart'),
    ).resolves.toBe(unknownMessage('chatterbox:kokoro_af_heart'));
  });

  it('rejects an unknown bare voice with a pointer at GET /api/persona/voices', async () => {
    await expect(
      validatePersonaVoiceInput(supabaseMock(), USER_ID, 'energetic'),
    ).resolves.toBe(unknownMessage('energetic'));
  });

  it('accepts a clone the served catalog lists', async () => {
    vi.mocked(fetchPersonaVoiceCatalogIds).mockResolvedValue(
      new Set(['chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb']),
    );
    await expect(
      validatePersonaVoiceInput(supabaseMock(), USER_ID, 'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb'),
    ).resolves.toBeNull();
  });

  it('rejects a clone when the catalog carries other clones but not this one', async () => {
    vi.mocked(fetchPersonaVoiceCatalogIds).mockResolvedValue(
      new Set(['chatterbox_nano:ucccccccccccc_bbbbbbbbbbbb']),
    );
    await expect(
      validatePersonaVoiceInput(supabaseMock(), USER_ID, 'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb'),
    ).resolves.toBe(unknownMessage('chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb'));
  });

  it('checks clone availability in the database when the catalog is down (clone: ready row)', async () => {
    await expect(
      validatePersonaVoiceInput(supabaseMock(1), USER_ID, 'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb'),
    ).resolves.toBeNull();
  });

  it('checks clone availability in the database when the catalog is down (clone: no ready row)', async () => {
    await expect(
      validatePersonaVoiceInput(supabaseMock(0), USER_ID, 'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb'),
    ).resolves.toBe(unknownMessage('chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb'));
  });
});

describe('applyPersonaVoicePatch', () => {
  interface Updates extends Record<string, unknown> {
    voice_id?: unknown;
    voice_audio_path?: unknown;
  }

  const personaFixture = (voiceId: unknown, audioPath: unknown) => ({
    voice_id: voiceId,
    voice_audio_path: audioPath,
  });

  it('skips everything when no voiceId was sent', async () => {
    const updates: Updates = {};
    const stalePaths: string[] = [];
    await expect(
      applyPersonaVoicePatch(supabaseMock(), USER_ID, personaFixture('energetic', null), null, updates, stalePaths),
    ).resolves.toBeNull();
    expect(updates).toEqual({});
    expect(stalePaths).toEqual([]);
    expect(fetchPersonaVoiceCatalogIds).not.toHaveBeenCalled();
  });

  it('never re-validates a voice the persona already stores (16 personas store bare legacy names)', async () => {
    const updates: Updates = {};
    const stalePaths: string[] = [];
    await expect(
      applyPersonaVoicePatch(
        supabaseMock(), USER_ID, personaFixture('energetic', `${USER_ID}/voz.mp3`),
        'energetic', updates, stalePaths,
      ),
    ).resolves.toBeNull();
    expect(fetchPersonaVoiceCatalogIds).not.toHaveBeenCalled();
    expect(updates.voice_id).toBe('energetic');
    expect(updates.voice_audio_path).toBeNull();
    expect(stalePaths).toEqual([`${USER_ID}/voz.mp3`]);
  });

  it('stores a new valid voice and clears the clone audio path', async () => {
    vi.mocked(fetchPersonaVoiceCatalogIds).mockResolvedValue(
      new Set(['chatterbox:kokoro_af_heart']),
    );
    const updates: Updates = {};
    const stalePaths: string[] = [];
    await expect(
      applyPersonaVoicePatch(
        supabaseMock(), USER_ID, personaFixture(null, `${USER_ID}/voz.mp3`),
        'chatterbox:kokoro_af_heart', updates, stalePaths,
      ),
    ).resolves.toBeNull();
    expect(updates.voice_id).toBe('chatterbox:kokoro_af_heart');
    expect(updates.voice_audio_path).toBeNull();
    expect(stalePaths).toEqual([`${USER_ID}/voz.mp3`]);
  });

  it('rejects a new unknown voice before any write', async () => {
    const updates: Updates = {};
    const stalePaths: string[] = [];
    await expect(
      applyPersonaVoicePatch(
        supabaseMock(), USER_ID, personaFixture('voz-antiga', null),
        'energetic', updates, stalePaths,
      ),
    ).resolves.toBe(unknownMessage('energetic'));
    expect(updates).toEqual({});
    expect(stalePaths).toEqual([]);
  });
});

describe('cloneVoiceAvailable', () => {
  it('is true when a ready clone row exists', async () => {
    await expect(cloneVoiceAvailable(supabaseMock(1), USER_ID, 'uaaaaaaaaaaaa_bbbbbbbbbbbb')).resolves.toBe(true);
  });

  it('is false when no ready clone row exists', async () => {
    await expect(cloneVoiceAvailable(supabaseMock(0), USER_ID, 'uaaaaaaaaaaaa_bbbbbbbbbbbb')).resolves.toBe(false);
  });
});
