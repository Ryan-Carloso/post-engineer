// @vitest-environment node
import { NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from '../route';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(async () => ({
    auth: { userId: 'user-1', isApiKey: false, isOAuth: false },
    error: null,
  })),
  engineAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer secret', 'x-user-id': 'user-1' })),
}));

vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_LIMITS: { voiceCloneCreate: { name: 'voice-clone-create', limit: 3, windowMs: 3600000 } },
}));

vi.mock('@/lib/api-error-reporting', () => ({
  withApiErrorReporting: (_route: string, handler: (req: Request, ...args: unknown[]) => Promise<Response>) =>
    handler,
  resolveReportingUserId: () => 'user-1',
}));

vi.mock('@/lib/cloned-voice-audio', () => ({
  validateCloneReferenceBuffer: vi.fn(() => ({ ok: true as const })),
}));

import { applyRateLimit } from '@/lib/rate-limit';
import { requireSupabaseSession } from '@/lib/request-auth';

function mockAuthErrorOnce(): void {
  vi.mocked(requireSupabaseSession).mockResolvedValueOnce({
    auth: null,
    error: NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 }),
  });
}

function validForm(overrides?: { language?: string }): FormData {
  const form = new FormData();
  form.set('consent', 'true');
  form.set('language', overrides?.language ?? 'en');
  form.set('file', new Blob([new Uint8Array(44)], { type: 'audio/wav' }), 'a.wav');
  return form;
}

describe('GET /api/persona/cloned-voices', () => {
  beforeEach(() => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://127.0.0.1:8080');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns 502 when engine body is not an array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ body: { not: 'array' } }),
      })),
    );

    const response = await GET(new Request('http://localhost/api/persona/cloned-voices'));
    expect(response.status).toBe(502);
    const json = await response.json();
    expect(json.error).toBe('Invalid cloned voices payload.');
  });

  it('returns voices from engine envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          body: [{ id: 'c1', status: 'ready', language: 'pt', voice_id: 'chatterbox:u1' }],
        }),
      })),
    );

    const response = await GET(new Request('http://localhost/api/persona/cloned-voices'));
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.voices).toHaveLength(1);
  });
});

describe('POST /api/persona/cloned-voices', () => {
  beforeEach(() => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://127.0.0.1:8080');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('proxies a valid create to the engine', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        body: {
          id: 'clone-1',
          status: 'pending',
          language: 'pt',
          voice_id: null,
          error_code: null,
          consent_at: '2026-01-01T00:00:00Z',
          created_at: null,
          updated_at: null,
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const form = new FormData();
    form.set('consent', 'true');
    form.set('language', 'en');
    form.set('file', new Blob([new Uint8Array(44)], { type: 'audio/wav' }), 'a.wav');
    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices', { method: 'POST', body: form }),
    );
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.voice.id).toBe('clone-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects missing consent', async () => {
    const form = new FormData();
    form.set('consent', 'false');
    form.set('language', 'en');
    form.set('file', new Blob([new Uint8Array(12)], { type: 'audio/wav' }), 'a.wav');
    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices', { method: 'POST', body: form }),
    );
    expect(response.status).toBe(400);
  });

  it('rejects missing language', async () => {
    const form = new FormData();
    form.set('consent', 'true');
    form.set('language', '   ');
    form.set('file', new Blob([new Uint8Array(12)], { type: 'audio/wav' }), 'a.wav');
    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices', { method: 'POST', body: form }),
    );
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe('Language is required.');
  });

  it('rejects a non-English language without calling the engine (English-only launch)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices', {
        method: 'POST',
        body: validForm({ language: 'pt' }),
      }),
    );
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe('Voice cloning is only available in English for now.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects invalid reference audio', async () => {
    const { validateCloneReferenceBuffer } = await import('@/lib/cloned-voice-audio');
    vi.mocked(validateCloneReferenceBuffer).mockReturnValueOnce({
      ok: false,
      error: 'Reference audio is empty.',
    });
    const form = new FormData();
    form.set('consent', 'true');
    form.set('language', 'en');
    form.set('file', new Blob([], { type: 'audio/wav' }), 'a.wav');
    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices', { method: 'POST', body: form }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Reference audio is empty.');
  });

  it('returns 502 when list upstream is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ message: 'down' }),
      })),
    );
    const response = await GET(new Request('http://localhost/api/persona/cloned-voices'));
    expect(response.status).toBe(502);
  });
});

describe('GET /api/persona/cloned-voices error branches', () => {
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

    const response = await GET(new Request('http://localhost/api/persona/cloned-voices'));
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe('Unauthorized.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 500 when the engine url env is missing', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new Request('http://localhost/api/persona/cloned-voices'));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('Configuration error.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 502 unreachable when the engine fetch throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connect ECONNREFUSED');
      }),
    );

    const response = await GET(new Request('http://localhost/api/persona/cloned-voices'));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe('Cloned voices service unreachable.');
  });

  it('calls the engine list url with auth headers and no-store cache', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ body: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new Request('http://localhost/api/persona/cloned-voices'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, voices: [] });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8080/api/v1/cloned-voices', {
      headers: { Authorization: 'Bearer secret', 'x-user-id': 'user-1' },
      cache: 'no-store',
    });
  });

  it('returns 502 when the engine payload has no body key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: 200, message: 'ok' }),
      })),
    );

    const response = await GET(new Request('http://localhost/api/persona/cloned-voices'));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe('Invalid cloned voices payload.');
  });

  it('returns 502 when the engine payload is not json', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError('not json');
        },
      })),
    );

    const response = await GET(new Request('http://localhost/api/persona/cloned-voices'));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe('Invalid cloned voices payload.');
  });

  it('filters out malformed rows and narrows the valid ones', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          body: [
            {
              id: 'c1',
              status: 'ready',
              language: 'pt',
              voice_id: 'chatterbox:u1',
              error_code: null,
              consent_at: null,
              created_at: null,
              updated_at: null,
              internal: 'dropped',
            },
            { bad: true },
            null,
          ],
        }),
      })),
    );

    const response = await GET(new Request('http://localhost/api/persona/cloned-voices'));
    const json = await response.json();
    expect(json).toEqual({
      success: true,
      voices: [
        {
          id: 'c1',
          status: 'ready',
          language: 'pt',
          voice_id: 'chatterbox:u1',
          error_code: null,
          consent_at: null,
          created_at: null,
          updated_at: null,
        },
      ],
    });
  });
});

describe('POST /api/persona/cloned-voices error branches', () => {
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
      new Request('http://localhost/api/persona/cloned-voices', { method: 'POST', body: validForm() }),
    );
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe('Unauthorized.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the rate-limit response before reading the body', async () => {
    vi.mocked(applyRateLimit).mockResolvedValueOnce(
      NextResponse.json({ success: false, error: 'Rate limit exceeded.' }, { status: 429 }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices', { method: 'POST', body: validForm() }),
    );
    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe('Rate limit exceeded.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a body that is not multipart form data', async () => {
    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices', {
        method: 'POST',
        body: 'plain text body',
        headers: { 'content-type': 'text/plain' },
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Invalid multipart body.');
  });

  it('rejects a missing file entry', async () => {
    const form = new FormData();
    form.set('consent', 'true');
    form.set('language', 'en');
    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices', { method: 'POST', body: form }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Reference audio file is required.');
  });

  it('rejects a file entry that is a plain string', async () => {
    const form = new FormData();
    form.set('consent', 'true');
    form.set('language', 'en');
    form.set('file', 'not-a-file');
    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices', { method: 'POST', body: form }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Reference audio file is required.');
  });

  it('rejects a missing language field', async () => {
    const form = new FormData();
    form.set('consent', 'true');
    form.set('file', new Blob([new Uint8Array(12)], { type: 'audio/wav' }), 'a.wav');
    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices', { method: 'POST', body: form }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Language is required.');
  });

  it('returns 500 when the engine url env is missing after validation', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices', { method: 'POST', body: validForm() }),
    );
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('Configuration error.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards the trimmed language and file to the engine form', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        body: { id: 'clone-9', status: 'pending', language: 'en', voice_id: null },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices', {
        method: 'POST',
        body: validForm({ language: ' en ' }),
      }),
    );
    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8080/api/v1/cloned-voices');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer secret', 'x-user-id': 'user-1' });
    const sent = init.body as FormData;
    expect(sent.get('consent')).toBe('true');
    expect(sent.get('language')).toBe('en');
    const sentFile = sent.get('file') as File;
    expect(sentFile.name).toBe('a.wav');
    expect(sentFile.type).toBe('audio/wav');
    expect(sentFile.size).toBe(44);
  });

  it('surfaces the engine message and status when create fails upstream', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 422,
        json: async () => ({ status: 422, message: 'Reference audio is too short.', body: null }),
      })),
    );

    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices', { method: 'POST', body: validForm() }),
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe('Reference audio is too short.');
  });

  it('falls back to the generic create error when upstream has no message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ body: null }),
      })),
    );

    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices', { method: 'POST', body: validForm() }),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('Could not start voice clone.');
  });

  it('returns 502 when the created row is malformed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 201,
        json: async () => ({ body: { id: 42, status: 'pending' } }),
      })),
    );

    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices', { method: 'POST', body: validForm() }),
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe('Invalid clone response.');
  });

  it('returns 502 when the create payload has no body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 201,
        json: async () => ({ status: 201, message: 'ok' }),
      })),
    );

    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices', { method: 'POST', body: validForm() }),
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe('Invalid clone response.');
  });

  it('returns 502 unreachable when the engine fetch throws on create', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('socket hang up');
      }),
    );

    const response = await POST(
      new Request('http://localhost/api/persona/cloned-voices', { method: 'POST', body: validForm() }),
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe('Cloned voices service unreachable.');
  });
});
