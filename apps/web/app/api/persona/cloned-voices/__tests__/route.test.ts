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

describe('GET /api/persona/cloned-voices', () => {
  beforeEach(() => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://127.0.0.1:8080');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
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
});
