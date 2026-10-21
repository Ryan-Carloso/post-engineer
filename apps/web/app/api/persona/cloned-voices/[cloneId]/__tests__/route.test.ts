// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE, GET } from '../route';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(async () => ({
    auth: { userId: 'user-1', isApiKey: false, isOAuth: false },
    error: null,
  })),
  engineAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer secret', 'x-user-id': 'user-1' })),
}));

vi.mock('@/lib/api-error-reporting', () => ({
  withApiErrorReporting: (_route: string, handler: (req: Request, ...args: unknown[]) => Promise<Response>) =>
    handler,
  resolveReportingUserId: () => 'user-1',
}));

const cloneRow = {
  id: 'clone-1',
  status: 'ready',
  language: 'pt',
  voice_id: 'chatterbox:u1',
  error_code: null,
  consent_at: null,
  created_at: null,
  updated_at: null,
};

describe('GET /api/persona/cloned-voices/:cloneId', () => {
  beforeEach(() => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://127.0.0.1:8080');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns a narrowed voice row from the engine', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ body: cloneRow }),
      })),
    );

    const response = await GET(new Request('http://localhost/api/persona/cloned-voices/clone-1'), {
      params: Promise.resolve({ cloneId: 'clone-1' }),
    });
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.voice.id).toBe('clone-1');
  });

  it('returns 404 when engine reports missing clone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
        json: async () => ({ message: 'not found' }),
      })),
    );

    const response = await GET(new Request('http://localhost/api/persona/cloned-voices/missing'), {
      params: Promise.resolve({ cloneId: 'missing' }),
    });
    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/persona/cloned-voices/:cloneId', () => {
  beforeEach(() => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://127.0.0.1:8080');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('proxies delete to the engine', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 204,
      })),
    );

    const response = await DELETE(new Request('http://localhost/api/persona/cloned-voices/clone-1', { method: 'DELETE' }), {
      params: Promise.resolve({ cloneId: 'clone-1' }),
    });
    const json = await response.json();
    expect(json.success).toBe(true);
  });
});
