// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../route';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(async () => ({
    auth: { userId: 'user-1', isApiKey: false, isOAuth: false },
    error: null,
  })),
  engineAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer <redacted>', 'x-user-id': 'user-1' })),
}));

vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_LIMITS: {
    voiceCloneCleanPreview: { name: 'voice-clone-clean-preview', limit: 10, windowMs: 60000 },
  },
}));

vi.mock('@/lib/api-error-reporting', () => ({
  withApiErrorReporting: (_route: string, handler: (req: Request) => Promise<Response>) => handler,
  resolveReportingUserId: () => 'user-1',
}));

/** Minimal valid WAV header (44 bytes) the reference validator accepts. */
function wavBlob(): Blob {
  const bytes = new Uint8Array(44);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45], 0);
  return new Blob([bytes], { type: 'audio/wav' });
}

function postForm(file: Blob | null): Request {
  const form = new FormData();
  if (file !== null) {
    form.set('file', file, 'ref.wav');
  }
  return new Request('http://localhost/api/persona/cloned-voices/clean-preview', {
    method: 'POST',
    body: form,
  });
}

describe('POST /api/persona/cloned-voices/clean-preview', () => {
  beforeEach(() => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://127.0.0.1:8080');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the cleaned wav from the engine', async () => {
    const cleaned = new Uint8Array([5, 4, 3, 2]);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'audio/wav' }),
      arrayBuffer: async () => cleaned.buffer,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(postForm(wavBlob()));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/wav');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(cleaned);
    const url = fetchMock.mock.calls[0]?.[0];
    expect(url).toBe('http://127.0.0.1:8080/api/v1/cloned-voices/clean-preview');
  });

  it('rejects a missing file with 400 and never calls the engine', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(postForm(null));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-audio file with 400', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(postForm(new Blob(['not audio'], { type: 'audio/wav' })));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps an engine 400 as 400', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        headers: new Headers(),
        arrayBuffer: async () => new ArrayBuffer(0),
      })),
    );

    const response = await POST(postForm(wavBlob()));

    expect(response.status).toBe(400);
  });

  it('maps other upstream failures to 502', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        headers: new Headers(),
        arrayBuffer: async () => new ArrayBuffer(0),
      })),
    );

    const response = await POST(postForm(wavBlob()));

    expect(response.status).toBe(502);
  });
});
