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
  RATE_LIMITS: { mediaUpload: { name: 'media-upload', limit: 10, windowMs: 60000 } },
}));

vi.mock('@/lib/api-error-reporting', () => ({
  withApiErrorReporting: (_route: string, handler: (req: Request, ...args: unknown[]) => Promise<Response>) =>
    handler,
  resolveReportingUserId: () => 'user-1',
}));

import { applyRateLimit } from '@/lib/rate-limit';
import { requireSupabaseSession } from '@/lib/request-auth';

function mockAuthErrorOnce(): void {
  vi.mocked(requireSupabaseSession).mockResolvedValueOnce({
    auth: null,
    error: NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 }),
  });
}

function ctx(cloneId: string): { params: Promise<{ cloneId: string }> } {
  return { params: Promise.resolve({ cloneId }) };
}

function okAudioFetch(audioBytes: Uint8Array, contentType: string | null) {
  return vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    headers: new Headers(contentType === null ? {} : { 'content-type': contentType }),
    arrayBuffer: async () => audioBytes.buffer,
  }));
}

describe('POST /api/persona/cloned-voices/:cloneId/preview', () => {
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
      new Request('http://localhost/api/persona/cloned-voices/clone-1/preview?language=pt'),
      { params: Promise.resolve({ cloneId: 'clone-1' }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body).toEqual(audioBytes);
  });
});

describe('POST /api/persona/cloned-voices/:cloneId/preview error branches', () => {
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
      new Request('http://localhost/api/persona/cloned-voices/clone-1/preview', { method: 'POST' }),
      ctx('clone-1'),
    );
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe('Unauthorized.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the rate-limit response before resolving the clone id', async () => {
    vi.mocked(applyRateLimit).mockResolvedValueOnce(
      NextResponse.json({ success: false, error: 'Rate limit exceeded.' }, { status: 429 }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices/clone-1/preview', { method: 'POST' }),
      ctx('clone-1'),
    );
    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe('Rate limit exceeded.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a blank clone id', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices/%20/preview', { method: 'POST' }),
      ctx('  '),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Clone id is required.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 500 when the engine url env is missing', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', undefined);

    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices/clone-1/preview', { method: 'POST' }),
      ctx('clone-1'),
    );
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('Configuration error.');
  });

  it('posts to the encoded engine preview url without a language query when absent', async () => {
    const fetchMock = okAudioFetch(new Uint8Array([9, 8]), 'audio/wav');
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices/a%2Fb/preview', { method: 'POST' }),
      ctx('a/b'),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/wav');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/api/v1/cloned-voices/a%2Fb/preview',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'x-user-id': 'user-1' },
      },
    );
  });

  it('trims the language query before forwarding it to the engine', async () => {
    const fetchMock = okAudioFetch(new Uint8Array([1]), 'audio/mpeg');
    vi.stubGlobal('fetch', fetchMock);

    await POST(
      new Request('http://localhost/api/persona/cloned-voices/clone-1/preview?language=%20pt%20', {
        method: 'POST',
      }),
      ctx('clone-1'),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:8080/api/v1/cloned-voices/clone-1/preview?language=pt',
    );
  });

  it('does not forward a blank language query to the engine', async () => {
    const fetchMock = okAudioFetch(new Uint8Array([1]), 'audio/mpeg');
    vi.stubGlobal('fetch', fetchMock);

    await POST(
      new Request('http://localhost/api/persona/cloned-voices/clone-1/preview?language=%20%20', {
        method: 'POST',
      }),
      ctx('clone-1'),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:8080/api/v1/cloned-voices/clone-1/preview',
    );
  });

  it('defaults the content type to audio/mpeg and disables caching', async () => {
    const audioBytes = new Uint8Array([5, 6, 7]);
    vi.stubGlobal('fetch', okAudioFetch(audioBytes, null));

    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices/clone-1/preview', { method: 'POST' }),
      ctx('clone-1'),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(audioBytes);
  });

  it('returns 404 when the engine reports a missing clone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));

    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices/missing/preview', { method: 'POST' }),
      ctx('missing'),
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('Cloned voice not found.');
  });

  it('returns 502 when the engine preview fails with a non-404 status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));

    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices/clone-1/preview', { method: 'POST' }),
      ctx('clone-1'),
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
      new Request('http://localhost/api/persona/cloned-voices/clone-1/preview', { method: 'POST' }),
      ctx('clone-1'),
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe('Preview service unreachable.');
  });
});
