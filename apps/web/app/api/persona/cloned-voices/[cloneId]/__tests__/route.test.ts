// @vitest-environment node
import { NextResponse } from 'next/server';
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

describe('GET /api/persona/cloned-voices/:cloneId error branches', () => {
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

    const response = await GET(
      new Request('http://localhost/api/persona/cloned-voices/clone-1'),
      ctx('clone-1'),
    );
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe('Unauthorized.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a blank clone id', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://localhost/api/persona/cloned-voices/%20'),
      ctx('   '),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Clone id is required.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 500 when the engine url env is missing', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', undefined);

    const response = await GET(
      new Request('http://localhost/api/persona/cloned-voices/clone-1'),
      ctx('clone-1'),
    );
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('Configuration error.');
  });

  it('encodes the clone id and sends auth headers to the engine', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ body: cloneRow }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://localhost/api/persona/cloned-voices/a%2Fb'),
      ctx('a/b'),
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8080/api/v1/cloned-voices/a%2Fb', {
      headers: { Authorization: 'Bearer secret', 'x-user-id': 'user-1' },
      cache: 'no-store',
    });
  });

  it('returns 502 when the engine fails with a non-404 status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ message: 'boom' }),
      })),
    );

    const response = await GET(
      new Request('http://localhost/api/persona/cloned-voices/clone-1'),
      ctx('clone-1'),
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe('Cloned voice unavailable.');
  });

  it('returns 502 when the engine row is malformed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ body: { id: 'clone-1' } }),
      })),
    );

    const response = await GET(
      new Request('http://localhost/api/persona/cloned-voices/clone-1'),
      ctx('clone-1'),
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe('Invalid clone response.');
  });

  it('returns 502 when the engine payload has no body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: 200, message: 'ok' }),
      })),
    );

    const response = await GET(
      new Request('http://localhost/api/persona/cloned-voices/clone-1'),
      ctx('clone-1'),
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe('Invalid clone response.');
  });

  it('returns 502 unreachable when the engine fetch throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connect ECONNREFUSED');
      }),
    );

    const response = await GET(
      new Request('http://localhost/api/persona/cloned-voices/clone-1'),
      ctx('clone-1'),
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe('Cloned voices service unreachable.');
  });
});

describe('DELETE /api/persona/cloned-voices/:cloneId error branches', () => {
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

    const response = await DELETE(
      new Request('http://localhost/api/persona/cloned-voices/clone-1', { method: 'DELETE' }),
      ctx('clone-1'),
    );
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe('Unauthorized.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a blank clone id', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await DELETE(
      new Request('http://localhost/api/persona/cloned-voices/%20', { method: 'DELETE' }),
      ctx(''),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Clone id is required.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 500 when the engine url env is missing', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', undefined);

    const response = await DELETE(
      new Request('http://localhost/api/persona/cloned-voices/clone-1', { method: 'DELETE' }),
      ctx('clone-1'),
    );
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('Configuration error.');
  });

  it('sends a DELETE with auth headers to the encoded engine url', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await DELETE(
      new Request('http://localhost/api/persona/cloned-voices/a%2Fb', { method: 'DELETE' }),
      ctx('a/b'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8080/api/v1/cloned-voices/a%2Fb', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer secret', 'x-user-id': 'user-1' },
    });
  });

  it('returns 404 when the engine reports a missing clone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));

    const response = await DELETE(
      new Request('http://localhost/api/persona/cloned-voices/missing', { method: 'DELETE' }),
      ctx('missing'),
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('Cloned voice not found.');
  });

  it('returns 502 when the engine delete fails with a non-404 status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));

    const response = await DELETE(
      new Request('http://localhost/api/persona/cloned-voices/clone-1', { method: 'DELETE' }),
      ctx('clone-1'),
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe('Could not delete cloned voice.');
  });

  it('returns 502 unreachable when the engine fetch throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('socket hang up');
      }),
    );

    const response = await DELETE(
      new Request('http://localhost/api/persona/cloned-voices/clone-1', { method: 'DELETE' }),
      ctx('clone-1'),
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe('Cloned voices service unreachable.');
  });
});
