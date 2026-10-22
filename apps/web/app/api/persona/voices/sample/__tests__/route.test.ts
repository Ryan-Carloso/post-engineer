// @vitest-environment node
import { NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../route';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(async () => ({
    auth: { userId: 'user-1', isApiKey: false, isOAuth: false },
    error: null,
  })),
  engineAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer <redacted>', 'x-user-id': 'user-1' })),
}));

vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_LIMITS: { voiceSample: { name: 'voice-sample', limit: 60, windowMs: 60000 } },
}));

vi.mock('@/lib/api-error-reporting', () => ({
  withApiErrorReporting: (_route: string, handler: (req: Request) => Promise<Response>) => handler,
  resolveReportingUserId: () => 'user-1',
}));

import { requireSupabaseSession } from '@/lib/request-auth';

describe('GET /api/persona/voices/sample', () => {
  beforeEach(() => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://127.0.0.1:8080');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('streams the engine sample audio for the requested voice', async () => {
    const audioBytes = new Uint8Array([9, 8, 7]);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'audio/mpeg' }),
      arrayBuffer: async () => audioBytes.buffer,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://localhost/api/persona/voices/sample?voice_id=phonon%3AZoey'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(audioBytes);
    const url = fetchMock.mock.calls[0]?.[0];
    expect(url).toBe(
      'http://127.0.0.1:8080/api/v1/personas/voices/phonon%3AZoey/sample',
    );
  });

  it('rejects a missing voice_id with 400 and never calls the engine', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new Request('http://localhost/api/persona/voices/sample'));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an over-long voice_id with 400', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request(`http://localhost/api/persona/voices/sample?voice_id=${'x'.repeat(201)}`),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps an upstream failure to 502', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
        headers: new Headers(),
        arrayBuffer: async () => new ArrayBuffer(0),
      })),
    );

    const response = await GET(
      new Request('http://localhost/api/persona/voices/sample?voice_id=phonon%3ANope'),
    );

    expect(response.status).toBe(502);
  });

  it('returns the auth error without calling the engine', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValueOnce({
      auth: null,
      error: NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 }),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://localhost/api/persona/voices/sample?voice_id=phonon%3AZoey'),
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
