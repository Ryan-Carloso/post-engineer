import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@/lib/api-keys', () => ({
  resolveApiKey: vi.fn(),
  validateApiKeyFormat: (key: string) => key.startsWith('post-engineer_'),
}));

//---------------
// GET /api/persona/voices tests — proxy of the house voice catalog to
// money-print. Auth = Supabase session. Only Supabase SSR and the global
// fetch (HTTP) are mocked. Upstream mocks use the real engine envelope
// (BaseResponse: { status, message, body }) so the tests pin the
// production contract instead of a fake shape.
//---------------

import { GET } from '../route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { resolveApiKey } from '@/lib/api-keys';

const USER_ID = 'user-1';
const ACCESS_TOKEN = 'sb-voices-token';
const API_SECRET = 'engine-shared-secret';

function mockSession(opts?: { noSession?: boolean; noToken?: boolean }): void {
  const client = {
    auth: {
      getUser: vi.fn(async () =>
        opts?.noSession
          ? { data: { user: null }, error: null }
          : { data: { user: { id: USER_ID } }, error: null },
      ),
      getSession: vi.fn(async () =>
        opts?.noToken
          ? { data: { session: null }, error: null }
          : { data: { session: { access_token: ACCESS_TOKEN } }, error: null },
      ),
    },
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
}

const fetchMock = vi.fn<typeof fetch>();

describe('GET /api/persona/voices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('MONEYPRINT_API_URL', 'http://moneyprint.internal:8080');
    vi.stubEnv('MONEYPRINT_API_SECRET', API_SECRET);
    mockSession();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('proxifica o catálogo de vozes do money-print com o token da sessão', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        status: 200,
        message: 'success',
        body: [
          { id: 'calm' },
          { id: 'energetic' },
        ],
      }),
    );

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      voices: [
        { id: 'calm' },
        { id: 'energetic' },
      ],
    });
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers as HeadersInit);
    expect(headers.get('authorization')).toBe(`Bearer ${API_SECRET}`);
    expect(headers.get('x-api-key')).toBeNull();
    expect(headers.get('x-user-id')).toBe(USER_ID);
  });

  it('aceita API key pessoal via Authorization Bearer (MCP)', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue({} as never);
    vi.mocked(resolveApiKey).mockResolvedValue({
      userId: USER_ID,
      keyId: 'key-1',
      personaIds: null,
    });
    fetchMock.mockResolvedValue(
      Response.json({
        status: 200,
        message: 'success',
        body: [{ id: 'calm' }, { id: 'energetic' }],
      }),
    );

    const req = new Request('http://localhost:3434/api/persona/voices', {
      headers: { Authorization: 'Bearer post-engineer_test123' },
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      voices: [{ id: 'calm' }, { id: 'energetic' }],
    });
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers as HeadersInit);
    expect(headers.get('x-user-id')).toBe(USER_ID);
  });

  it('retorna 401 com API key inválida', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue({} as never);
    vi.mocked(resolveApiKey).mockResolvedValue(null);

    const req = new Request('http://localhost:3434/api/persona/voices', {
      headers: { Authorization: 'Bearer post-engineer_invalid' },
    });
    const res = await GET(req);

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retorna 401 sem sessão', async () => {
    mockSession({ noSession: true });

    const res = await GET();

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retorna 401 com sessão sem access token', async () => {
    mockSession({ noToken: true });

    const res = await GET();

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retorna 500 quando MONEYPRINT_API_URL não está definida', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', '');

    const res = await GET();

    expect(res.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retorna 502 quando o money-print falha', async () => {
    fetchMock.mockResolvedValue(new Response('erro', { status: 500 }));

    const res = await GET();

    expect(res.status).toBe(502);
  });

  it('retorna 502 com payload de vozes inválido', async () => {
    fetchMock.mockResolvedValue(Response.json({ status: 200, message: 'success', body: 'not-an-array' }));

    const res = await GET();

    expect(res.status).toBe(502);
  });

  it('retorna 502 quando o money-print está inacessível', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));

    const res = await GET();

    expect(res.status).toBe(502);
  });
});
