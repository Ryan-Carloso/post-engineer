// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

import {
  checkFullLipsyncNarration,
  FULL_LIPSYNC_MAX_SECONDS,
} from '../full-lipsync-preflight';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function engineBody(duration: number): Response {
  return new Response(JSON.stringify({ status: 200, body: { audio_duration_seconds: duration } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(response: Response | Error): Array<{ url: string; init: RequestInit }> {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (response instanceof Error) throw response;
      return response;
    }),
  );
  return calls;
}

const INPUT = {
  userId: 'user-1',
  script: 'Hello Lisbon, this is a test narration.',
  language: 'en-US',
  voiceId: 'chatterbox:kokoro_af_heart',
};

describe('checkFullLipsyncNarration', () => {
  beforeEach(() => {
    vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'engine-secret');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('pins the cap at 60s, mirroring the engine full_lipsync cap', () => {
    expect(FULL_LIPSYNC_MAX_SECONDS).toBe(60);
  });

  it('passes a narration at exactly 60s and sends the video task inputs', async () => {
    const calls = stubFetch(engineBody(60));
    const result = await checkFullLipsyncNarration(INPUT);
    expect(result).toBe(60);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://engine.test/api/v1/audio/preflight-duration');
    const body = JSON.parse(calls[0].init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      video_script: INPUT.script,
      video_language: 'en-US',
      voice_name: 'chatterbox:kokoro_af_heart',
      voice_audio_url: null,
    });
    expect(calls[0].init.headers).toMatchObject({ 'x-user-id': 'user-1' });
  });

  it('rejects a 61s narration with a 400 naming options.fullLipsync', async () => {
    stubFetch(engineBody(61));
    const result = await checkFullLipsyncNarration(INPUT);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(400);
    const payload = (await (result as NextResponse).json()) as { error?: string };
    expect(payload.error).toContain('options.fullLipsync');
  });

  it('maps an engine 400 (voice-audio rejection) to a 400, not a proceed', async () => {
    stubFetch(new Response(JSON.stringify({ message: 'voice audio rejected' }), { status: 400 }));
    const result = await checkFullLipsyncNarration({
      ...INPUT,
      voiceId: undefined,
      voiceAudioUrl: 'https://e.com/narration.mp3',
    });
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(400);
  });

  it('fails closed with 502 when the engine is unreachable', async () => {
    stubFetch(new Error('connect refused'));
    const result = await checkFullLipsyncNarration(INPUT);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(502);
  });

  it('fails closed with 502 on a non-numeric duration', async () => {
    stubFetch(
      new Response(JSON.stringify({ status: 200, body: { audio_duration_seconds: 'soon' } }), {
        status: 200,
      }),
    );
    const result = await checkFullLipsyncNarration(INPUT);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(502);
  });

  it('fails closed with 502 when the engine URL is not configured', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', undefined);
    const result = await checkFullLipsyncNarration(INPUT);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(502);
  });
});
