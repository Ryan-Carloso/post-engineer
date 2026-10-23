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
  RATE_LIMITS: {
    voiceCloneDenoisePreview: { name: 'voice-clone-denoise-preview', limit: 20, windowMs: 3600000 },
  },
}));

vi.mock('@/lib/api-error-reporting', () => ({
  withApiErrorReporting: (_route: string, handler: (req: Request, ...args: unknown[]) => Promise<Response>) =>
    handler,
  resolveReportingUserId: () => 'user-1',
}));

const validation = vi.hoisted(() => ({ result: { ok: true } as { ok: true } | { ok: false; error: string } }));
vi.mock('@/lib/cloned-voice-audio', () => ({
  validateCloneReferenceBuffer: vi.fn(() => validation.result),
}));

import { applyRateLimit } from '@/lib/rate-limit';
import { requireSupabaseSession } from '@/lib/request-auth';

const URL_ = 'http://localhost/api/persona/cloned-voices/denoise-preview';

function form(withFile = true): FormData {
  const body = new FormData();
  if (withFile) {
    body.set('file', new Blob([new Uint8Array(44)], { type: 'audio/webm' }), 'a.webm');
  }
  return body;
}

describe('POST /api/persona/cloned-voices/denoise-preview', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    validation.result = { ok: true };
    vi.stubEnv('MONEYPRINT_API_URL', 'http://127.0.0.1:8080');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('proxies the file to the engine and returns the cleaned wav', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/wav' } }));

    const response = await POST(new Request(URL_, { method: 'POST', body: form() }));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/wav');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8080/api/v1/cloned-voices/denoise-preview');
    expect((init.body as FormData).get('file')).toBeInstanceOf(Blob);
  });

  it('authenticates by cookie session only (never resolves bearer headers)', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/wav' } }));
    vi.mocked(requireSupabaseSession).mockClear();
    await POST(
      new Request(URL_, { method: 'POST', body: form(), headers: { authorization: 'Bearer pe_live_key' } }),
    );
    expect(requireSupabaseSession).toHaveBeenCalledTimes(1);
    expect(vi.mocked(requireSupabaseSession).mock.calls[0]).toEqual([]);
  });

  it('returns 401 for an API-key bearer caller with no cookie session', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValueOnce({
      auth: null,
      error: NextResponse.json(
        { success: false, error: 'Authentication required.' },
        { status: 401 },
      ),
    });

    const response = await POST(
      new Request(URL_, { method: 'POST', body: form(), headers: { authorization: 'Bearer pe_live_key' } }),
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('applies the denoise preview rate limit', async () => {
    vi.mocked(applyRateLimit).mockResolvedValueOnce(
      NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 }),
    );
    const response = await POST(new Request(URL_, { method: 'POST', body: form() }));
    expect(response.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 401 without a session', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValueOnce({
      auth: null,
      error: NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 }),
    });
    const response = await POST(new Request(URL_, { method: 'POST', body: form() }));
    expect(response.status).toBe(401);
  });

  it('rejects a missing file or invalid audio before calling the engine', async () => {
    expect((await POST(new Request(URL_, { method: 'POST', body: form(false) }))).status).toBe(400);
    validation.result = { ok: false, error: 'bad audio' };
    const invalid = await POST(new Request(URL_, { method: 'POST', body: form() }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ success: false, error: 'bad audio' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the engine message and status on upstream failure', async () => {
    fetchMock.mockResolvedValue(Response.json({ status: 400, message: 'could not decode reference audio' }, { status: 400 }));
    const response = await POST(new Request(URL_, { method: 'POST', body: form() }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'could not decode reference audio' });
  });

  it('returns 502 for a non-audio 200 body or an unreachable engine', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    expect((await POST(new Request(URL_, { method: 'POST', body: form() }))).status).toBe(502);
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect((await POST(new Request(URL_, { method: 'POST', body: form() }))).status).toBe(502);
  });
});
