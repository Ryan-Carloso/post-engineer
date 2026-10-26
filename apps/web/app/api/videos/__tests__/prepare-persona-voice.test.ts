import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));

vi.mock('@/lib/posthog-server', () => ({
  getPostHogServer: vi.fn(() => ({ captureAs: vi.fn() })),
}));

vi.mock('@/lib/voice-catalog-fetch', () => ({
  fetchPersonaVoiceCatalogIds: vi.fn().mockResolvedValue(undefined),
  fetchPersonaVoiceOptions: vi.fn(),
}));

vi.mock('../generate-and-schedule/persona-prep', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../generate-and-schedule/persona-prep')>();
  return { ...actual, signedUrl: vi.fn().mockResolvedValue(null) };
});

import { fetchPersonaVoiceCatalogIds } from '@/lib/voice-catalog-fetch';
import {
  cloneVoiceAvailable,
  persistVoiceSwap,
  preparePersona,
} from '../generate-and-schedule/prepare-persona';
import { VOICE_FALLBACK_REASONS } from '@/lib/voice-fallback';

const USER_ID = 'user-uuid-1';
const PERSONA_ID = 'persona-1';
const CLONE_KEY = 'uaaaaaaaaaaaa_bbbbbbbbbbbb';

type EqCall = { table: string; col: string; val: unknown };

function recordingClient(tableName: string, eqCalls: EqCall[]): SupabaseClient {
  const chain: Record<string, unknown> = {
    select: () => chain,
    update: () => chain,
    limit: () => chain,
    eq: (col: string, val: unknown) => {
      eqCalls.push({ table: tableName, col, val });
      return chain;
    },
    then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve({ data: [{ engine_voice_key: CLONE_KEY }], error: null }).then(resolve, reject),
  };
  return { from: vi.fn(() => chain) } as unknown as SupabaseClient;
}

describe('cloneVoiceAvailable / persistVoiceSwap predicates', () => {
  it('scopes the cloned_voices lookup to user_id, engine_voice_key, and status ready', async () => {
    const eqCalls: EqCall[] = [];
    const supabase = recordingClient('cloned_voices', eqCalls);
    await expect(cloneVoiceAvailable(supabase, USER_ID, CLONE_KEY)).resolves.toBe(true);
    expect(eqCalls).toEqual([
      { table: 'cloned_voices', col: 'user_id', val: USER_ID },
      { table: 'cloned_voices', col: 'engine_voice_key', val: CLONE_KEY },
      { table: 'cloned_voices', col: 'status', val: 'ready' },
    ]);
  });

  it('scopes the personas voice-swap update to id and user_id', async () => {
    const eqCalls: EqCall[] = [];
    const supabase = recordingClient('personas', eqCalls);
    await persistVoiceSwap(supabase, USER_ID, PERSONA_ID, {
      fromVoice: 'energetic',
      toVoice: 'chatterbox:kokoro_af_heart',
      reason: VOICE_FALLBACK_REASONS.UNKNOWN_VOICE,
    });
    expect(eqCalls).toEqual([
      { table: 'personas', col: 'id', val: PERSONA_ID },
      { table: 'personas', col: 'user_id', val: USER_ID },
    ]);
  });
});

describe('preparePersona catalog fetch', () => {
  const PERSONA = {
    id: PERSONA_ID,
    name: 'Ana',
    photo_path: null,
    avatar_url: 'https://cdn.example/avatar.png',
    voice_id: 'no-voice',
    voice_audio_path: null,
    language: 'en',
    video_aspect: '9:16',
    video_layout: null,
    script_prompt: null,
    cta_text: null,
    paragraph_number: 5,
    niche: 'fitness',
    face_quality: 'ok',
  };

  function personaClient(voiceId: string | null): SupabaseClient {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      single: async () => ({ data: { ...PERSONA, voice_id: voiceId }, error: null }),
    };
    return { from: vi.fn(() => chain) } as unknown as SupabaseClient;
  }

  beforeEach(() => {
    vi.mocked(fetchPersonaVoiceCatalogIds).mockClear();
    vi.mocked(fetchPersonaVoiceCatalogIds).mockResolvedValue(undefined);
  });

  const opts = { faceless: true };

  it.each([
    ['no-voice'],
    ['none'],
    ['elevenlabs:abc'],
    ['openrouter:model:voice'],
    ['energetic'],
  ])('does not fetch the engine catalog for %s', async (voiceId) => {
    await preparePersona(personaClient(voiceId), USER_ID, PERSONA_ID, opts);
    expect(fetchPersonaVoiceCatalogIds).not.toHaveBeenCalled();
  });

  it('fetches the engine catalog for a chatterbox house id', async () => {
    await preparePersona(personaClient('chatterbox:kokoro_af_heart'), USER_ID, PERSONA_ID, opts);
    expect(fetchPersonaVoiceCatalogIds).toHaveBeenCalledWith(USER_ID);
  });

  it('fetches the engine catalog for a chatterbox_nano clone id', async () => {
    await preparePersona(
      personaClient(`chatterbox_nano:${CLONE_KEY}`),
      USER_ID,
      PERSONA_ID,
      opts,
    );
    expect(fetchPersonaVoiceCatalogIds).toHaveBeenCalledWith(USER_ID);
  });
});
