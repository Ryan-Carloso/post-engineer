import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

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
import { preparePost } from '../generate-and-schedule/prepare-persona';

const USER_ID = 'user-uuid-1';
const PERSONA_ID = 'persona-1';
const CLONE_KEY = 'uaaaaaaaaaaaa_bbbbbbbbbbbb';
const CLONE_ID = `chatterbox_nano:${CLONE_KEY}`;

const PERSONA = {
  id: PERSONA_ID,
  name: 'Ana',
  photo_path: null,
  avatar_url: 'https://cdn.example/avatar.png',
  voice_id: 'chatterbox:kokoro_af_heart',
  voice_audio_path: null,
  language: 'en',
  video_aspect: '9:16',
  video_layout: null,
  cta_text: null,
  paragraph_number: 5,
  niche: 'fitness',
  face_quality: 'ok',
};

function makeSupabase(cloneRows: unknown[], personaVoiceId?: string): SupabaseClient {
  return {
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        update: () => chain,
        limit: () => chain,
        eq: () => chain,
        single: async () => ({ data: { ...PERSONA, voice_id: personaVoiceId ?? PERSONA.voice_id }, error: null }),
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
          Promise.resolve({ data: cloneRows, error: null }).then(resolve, reject),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

describe('preparePost explicit voiceId validation (issue #353 follow-up)', () => {
  beforeEach(() => {
    vi.mocked(fetchPersonaVoiceCatalogIds).mockClear();
    vi.mocked(fetchPersonaVoiceCatalogIds).mockResolvedValue(undefined);
  });

  it('rejects an explicit unknown voice with UNKNOWN_VOICE before any charge', async () => {
    const prep = await preparePost(makeSupabase([]), USER_ID, PERSONA_ID, {
      faceless: true,
      voiceId: 'energetic',
    });
    expect(prep).toBeInstanceOf(NextResponse);
    if (prep instanceof NextResponse) {
      expect(prep.status).toBe(400);
      const body = await prep.json();
      expect(body.code).toBe('UNKNOWN_VOICE');
      expect(body.field).toBe('options.voiceId');
      expect(body.error).toContain('energetic');
    }
  });

  it('rejects an explicit clone that is not one of the caller\'s READY clones', async () => {
    const prep = await preparePost(makeSupabase([]), USER_ID, PERSONA_ID, {
      faceless: true,
      voiceId: CLONE_ID,
    });
    expect(prep).toBeInstanceOf(NextResponse);
    if (prep instanceof NextResponse) {
      expect(prep.status).toBe(400);
      const body = await prep.json();
      expect(body.code).toBe('UNKNOWN_VOICE');
    }
  });

  it('passes an explicit clone that is one of the caller\'s READY clones', async () => {
    const prep = await preparePost(makeSupabase([{ engine_voice_key: CLONE_KEY }]), USER_ID, PERSONA_ID, {
      faceless: true,
      voiceId: CLONE_ID,
    });
    expect(prep).not.toBeInstanceOf(NextResponse);
    if (!(prep instanceof NextResponse)) {
      expect(prep.voiceIdValue).toBe(CLONE_ID);
    }
  });

  it('passes an explicit house voice (shape-only when the catalog is unreachable)', async () => {
    const prep = await preparePost(makeSupabase([]), USER_ID, PERSONA_ID, {
      faceless: true,
      voiceId: 'chatterbox:kokoro_af_heart',
    });
    expect(prep).not.toBeInstanceOf(NextResponse);
    if (!(prep instanceof NextResponse)) {
      expect(prep.voiceIdValue).toBe('chatterbox:kokoro_af_heart');
    }
  });

  it('rejects an explicit unknown voice on a persona-less post too', async () => {
    const prep = await preparePost(makeSupabase([]), USER_ID, null, {
      faceless: true,
      voiceId: 'energetic',
    });
    expect(prep).toBeInstanceOf(NextResponse);
    if (prep instanceof NextResponse) {
      expect(prep.status).toBe(400);
      const body = await prep.json();
      expect(body.code).toBe('UNKNOWN_VOICE');
    }
  });

  it('skips validation when a custom audioUrl wins (the voice is ignored)', async () => {
    const prep = await preparePost(makeSupabase([]), USER_ID, PERSONA_ID, {
      faceless: true,
      audioUrl: 'https://cdn.example/custom.mp3',
      voiceId: 'energetic',
    });
    expect(prep).not.toBeInstanceOf(NextResponse);
    if (!(prep instanceof NextResponse)) {
      expect(prep.voiceAudioUrl).toBe('https://cdn.example/custom.mp3');
    }
  });

  it('does not 400 a stored legacy voice when no explicit voice was sent (fallback, not rejection)', async () => {
    const prep = await preparePost(makeSupabase([], 'energetic'), USER_ID, PERSONA_ID, {
      faceless: true,
    });
    expect(prep).not.toBeInstanceOf(NextResponse);
    if (!(prep instanceof NextResponse)) {
      expect(prep.voiceFallback?.fromVoice).toBe('energetic');
      expect(prep.voiceIdValue).toBe('chatterbox:kokoro_af_heart');
    }
  });
});
