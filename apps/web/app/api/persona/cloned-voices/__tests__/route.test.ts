// @vitest-environment node
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
    form.set('language', 'pt');
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
    form.set('language', 'pt');
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

  it('rejects invalid reference audio', async () => {
    const { validateCloneReferenceBuffer } = await import('@/lib/cloned-voice-audio');
    vi.mocked(validateCloneReferenceBuffer).mockReturnValueOnce({
      ok: false,
      error: 'Reference audio is empty.',
    });
    const form = new FormData();
    form.set('consent', 'true');
    form.set('language', 'pt');
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
