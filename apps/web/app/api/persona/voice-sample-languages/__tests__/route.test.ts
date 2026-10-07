import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

//---------------
// GET /api/persona/voice-sample-languages tests — proxy of the voice
// sample language list. Auth = Supabase session. The upstream mock uses
// the real engine envelope (BaseResponse: { status, message, body }) so
// the tests pin the production contract instead of a fake shape.
//---------------

import { GET } from '../route';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const ACCESS_TOKEN = 'sb-langs-token';
const API_SECRET = 'engine-shared-secret';
const USER_ID = 'user-1';

function mockSession(opts?: { noSession?: boolean; noToken?: boolean }): void {
  const client = {
    auth: {
      getUser: vi.fn(async () =>
        opts?.noSession
          ? { data: { user: null }, error: null }
          : { data: { user: { id: 'user-1' } }, error: null },
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

describe('GET /api/persona/voice-sample-languages', () => {
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

  it('proxifica a lista de idiomas com o token da sessão', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        status: 200,
        message: 'success',
        body: [
          { code: 'en', label: 'English' },
          { code: 'pt', label: 'Português' },
        ],
      }),
    );

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      languages: [
        { code: 'en', label: 'English' },
        { code: 'pt', label: 'Português' },
      ],
    });
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers as HeadersInit);
    expect(headers.get('authorization')).toBe(`Bearer ${API_SECRET}`);
    expect(headers.get('x-api-key')).toBeNull();
    expect(headers.get('x-user-id')).toBe(USER_ID);
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

  it('retorna 502 quando o money-print falha ou payload inválido', async () => {
    fetchMock.mockResolvedValue(new Response('erro', { status: 500 }));

    const res = await GET();
    expect(res.status).toBe(502);

    fetchMock.mockResolvedValue(Response.json({ status: 200, message: 'success', body: null }));
    const res2 = await GET();
    expect(res2.status).toBe(502);
  });

  it('retorna 502 quando o money-print está inacessível', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));

    const res = await GET();

    expect(res.status).toBe(502);
  });

  it('inclui o corpo de erro exato na falha de configuração', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', '');

    const res = await GET();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      error: 'MONEYPRINT_API_URL is not defined',
    });
  });

  it('inclui o corpo de erro exato quando o money-print falha', async () => {
    fetchMock.mockResolvedValue(new Response('erro', { status: 500 }));

    const res = await GET();

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ success: false, error: 'Sample languages unavailable.' });
  });

  it('inclui o corpo de erro exato quando o money-print está inacessível', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));

    const res = await GET();

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      success: false,
      error: 'Sample languages service unreachable.',
    });
  });

  it.each([
    ['corpo não é array', 'not-an-array'],
    ['code não é string', [{ code: 1, label: 'English' }]],
    ['label ausente', [{ code: 'en' }]],
    ['item nulo', [null]],
    ['item não é objeto', ['x']],
    ['corpo ausente no envelope', undefined],
  ])('retorna 502 com payload de idiomas inválido (%s)', async (_label, body) => {
    fetchMock.mockResolvedValue(Response.json({ status: 200, message: 'success', body }));

    const res = await GET();

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      success: false,
      error: 'Invalid sample languages payload.',
    });
  });

  it('rejeita o formato antigo do envelope com chave data', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ status: 200, message: 'success', data: [{ code: 'en', label: 'x' }] }),
    );

    const res = await GET();

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      success: false,
      error: 'Invalid sample languages payload.',
    });
  });

  it('chama o endpoint do money-print sem barras finais e com cache no-store', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://moneyprint.internal:8080///');
    fetchMock.mockResolvedValue(
      Response.json({ status: 200, message: 'success', body: [{ code: 'en', label: 'English' }] }),
    );

    const res = await GET();

    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://moneyprint.internal:8080/api/v1/personas/voices/sample-languages',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' });
  });
});
