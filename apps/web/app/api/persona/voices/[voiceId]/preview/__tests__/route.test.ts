// @vitest-environment node
import { NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../route';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(async () => ({
    auth: { userId: 'user-1', isApiKey: false, isOAuth: false },
    error: null,
  })),
  engineAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer secret', 'x-user-id': 'user-1' })),
}));

vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_LIMITS: { voicePreview: { name: 'voice-preview', limit: 10, windowMs: 86_400_000 } },
}));

vi.mock('@/lib/api-error-reporting', () => ({
  withApiErrorReporting: (_route: string, handler: (req: Request, ...args: unknown[]) => Promise<Response>) =>
    handler,
  resolveReportingUserId: () => 'user-1',
}));

import { applyRateLimit } from '@/lib/rate-limit';
import { requireSupabaseSession } from '@/lib/request-auth';

const VOICE_ID = 'chatterbox:phonon_zoey';
const ENGINE_PREVIEW_URL = 'http://127.0.0.1:8080/api/v1/personas/voices/chatterbox%3Aphonon_zoey/preview';

function mockAuthErrorOnce(): void {
  vi.mocked(requireSupabaseSession).mockResolvedValueOnce({
    auth: null,
    error: NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 }),
  });
}

function ctx(voiceId: string): { params: Promise<{ voiceId: string }> } {
  return { params: Promise.resolve({ voiceId }) };
}

function okAudioFetch(audioBytes: Uint8Array, contentType: string | null) {
  return vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    headers: new Headers(contentType === null ? {} : { 'content-type': contentType }),
    arrayBuffer: async () => audioBytes.buffer,
  }));
}

describe('POST /api/persona/voices/:voiceId/preview', () => {
  beforeEach(() => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://127.0.0.1:8080');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('streams preview audio from the engine', async () => {
    const audioBytes = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'audio/mpeg' }),
        arrayBuffer: async () => audioBytes.buffer,
      })),
    );

    const response = await POST(
      new Request('http://localhost/api/persona/voices/chatterbox:phonon_zoey/preview', { method: 'POST' }),
      ctx(VOICE_ID),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body).toEqual(audioBytes);
  });
});

describe('POST /api/persona/voices/:voiceId/preview error branches', () => {
  beforeEach(() => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://127.0.0.1:8080');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns the auth error response without calling the engine', async () => {
    mockAuthErrorOnce();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new Request('http://localhost/api/persona/voices/chatterbox:phonon_zoey/preview', { method: 'POST' }),
      ctx(VOICE_ID),
    );
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe('Unauthorized.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the rate-limit response before resolving the voice id', async () => {
    vi.mocked(applyRateLimit).mockResolvedValueOnce(
      NextResponse.json({ success: false, error: 'Rate limit exceeded.' }, { status: 429 }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new Request('http://localhost/api/persona/voices/chatterbox:phonon_zoey/preview', { method: 'POST' }),
      ctx(VOICE_ID),
    );
    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe('Rate limit exceeded.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a blank voice id', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new Request('http://localhost/api/persona/voices/%20/preview', { method: 'POST' }),
      ctx('  '),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Voice id is required.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 500 when the engine url env is missing', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', undefined);

    const response = await POST(
      new Request('http://localhost/api/persona/voices/chatterbox:phonon_zoey/preview', { method: 'POST' }),
      ctx(VOICE_ID),
    );
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('Configuration error.');
  });

  it('posts to the encoded engine preview url', async () => {
    const fetchMock = okAudioFetch(new Uint8Array([9, 8]), 'audio/wav');
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new Request('http://localhost/api/persona/voices/chatterbox:phonon_zoey/preview', { method: 'POST' }),
      ctx(VOICE_ID),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/wav');
    expect(fetchMock).toHaveBeenCalledWith(ENGINE_PREVIEW_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer secret', 'x-user-id': 'user-1' },
    });
  });

  it('ignores a language query: house voices are English-only, there is no override', async () => {
    const fetchMock = okAudioFetch(new Uint8Array([1]), 'audio/mpeg');
    vi.stubGlobal('fetch', fetchMock);

    await POST(
      new Request('http://localhost/api/persona/voices/chatterbox:phonon_zoey/preview?language=pt', {
        method: 'POST',
      }),
      ctx(VOICE_ID),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(ENGINE_PREVIEW_URL);
  });

  it('defaults the content type to audio/mpeg and disables caching', async () => {
    const audioBytes = new Uint8Array([5, 6, 7]);
    vi.stubGlobal('fetch', okAudioFetch(audioBytes, null));

    const response = await POST(
      new Request('http://localhost/api/persona/voices/chatterbox:phonon_zoey/preview', { method: 'POST' }),
      ctx(VOICE_ID),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(audioBytes);
  });

  it('returns 404 when the engine reports a missing voice', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));

    const response = await POST(
      new Request('http://localhost/api/persona/voices/chatterbox:nope/preview', { method: 'POST' }),
      ctx('chatterbox:nope'),
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('Voice not found.');
  });

  it('returns 502 when the engine preview fails with a non-404 status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));

    const response = await POST(
      new Request('http://localhost/api/persona/voices/chatterbox:phonon_zoey/preview', { method: 'POST' }),
      ctx(VOICE_ID),
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe('Preview unavailable.');
  });

  it('returns 502 unreachable when the engine fetch throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connect ECONNREFUSED');
      }),
    );

    const response = await POST(
      new Request('http://localhost/api/persona/voices/chatterbox:phonon_zoey/preview', { method: 'POST' }),
      ctx(VOICE_ID),
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe('Preview service unreachable.');
  });
});

describe('POST /api/persona/voices/:voiceId/preview caller text', () => {
  beforeEach(() => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://127.0.0.1:8080');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('forwards trimmed text to the engine as a JSON body', async () => {
    const fetchMock = okAudioFetch(new Uint8Array([9]), 'audio/mpeg');
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new Request('http://localhost/api/persona/voices/chatterbox:phonon_zoey/preview', {
        method: 'POST',
        body: JSON.stringify({ text: '  say this  ' }),
      }),
      ctx(VOICE_ID),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ENGINE_PREVIEW_URL);
    expect(init?.body).toBe(JSON.stringify({ text: 'say this' }));
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    // The text never travels in the URL.
    expect(String(url).includes('say')).toBe(false);
  });

  it('keeps the no-body request unchanged (fixed sample)', async () => {
    const fetchMock = okAudioFetch(new Uint8Array([9]), 'audio/mpeg');
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new Request('http://localhost/api/persona/voices/chatterbox:phonon_zoey/preview', { method: 'POST' }),
      ctx(VOICE_ID),
    );

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get('content-type')).toBeNull();
  });

  it('rejects over-length text with 400 before calling the engine', async () => {
    const fetchMock = okAudioFetch(new Uint8Array([9]), 'audio/mpeg');
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new Request('http://localhost/api/persona/voices/chatterbox:phonon_zoey/preview', {
        method: 'POST',
        body: JSON.stringify({ text: 'a'.repeat(301) }),
      }),
      ctx(VOICE_ID),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 400 and logs when the request body cannot be read', async () => {
    const fetchMock = okAudioFetch(new Uint8Array([9]), 'audio/mpeg');
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const request = new Request('http://localhost/api/persona/voices/chatterbox:phonon_zoey/preview', {
      method: 'POST',
    });
    vi.spyOn(request, 'text').mockRejectedValueOnce(new Error('stream aborted'));

    const response = await POST(request, ctx(VOICE_ID));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ success: false, error: 'Invalid body.' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('rejects invalid JSON with 400 before calling the engine', async () => {
    const fetchMock = okAudioFetch(new Uint8Array([9]), 'audio/mpeg');
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new Request('http://localhost/api/persona/voices/chatterbox:phonon_zoey/preview', {
        method: 'POST',
        body: 'not-json{',
      }),
      ctx(VOICE_ID),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ success: false, error: 'Invalid JSON body.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('applies the daily voicePreview limit and stops at 429 without calling the engine', async () => {
    const fetchMock = okAudioFetch(new Uint8Array([9]), 'audio/mpeg');
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(applyRateLimit).mockResolvedValueOnce(
      NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 }),
    );

    const response = await POST(
      new Request('http://localhost/api/persona/voices/chatterbox:phonon_zoey/preview', {
        method: 'POST',
        body: JSON.stringify({ text: 'hi' }),
      }),
      ctx(VOICE_ID),
    );

    expect(response.status).toBe(429);
    expect(applyRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      { name: 'voice-preview', limit: 10, windowMs: 86_400_000 },
      'user-1',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
