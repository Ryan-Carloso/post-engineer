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

const voice = (id: string) => ({
  id,
  label: 'Heart',
  provider: 'kokoro',
  gender: 'female',
  accent: 'us',
  kind: 'standard',
});

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

  it('proxies the engine voice catalog with the session token', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        status: 200,
        message: 'success',
        body: [
          voice('chatterbox:kokoro_af_heart'),
          voice('chatterbox:phonon_zoey'),
        ],
      }),
    );

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      voices: [
        voice('chatterbox:kokoro_af_heart'),
        voice('chatterbox:phonon_zoey'),
      ],
    });
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers as HeadersInit);
    expect(headers.get('authorization')).toBe(`Bearer ${API_SECRET}`);
    expect(headers.get('x-api-key')).toBeNull();
    expect(headers.get('x-user-id')).toBe(USER_ID);
  });

  it('accepts a personal API key via Authorization Bearer (MCP)', async () => {
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
        body: [voice('chatterbox:kokoro_af_heart'), voice('chatterbox:phonon_zoey')],
      }),
    );

    const req = new Request('http://localhost:3434/api/persona/voices', {
      headers: { Authorization: 'Bearer post-engineer_test123' },
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      voices: [voice('chatterbox:kokoro_af_heart'), voice('chatterbox:phonon_zoey')],
    });
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers as HeadersInit);
    expect(headers.get('x-user-id')).toBe(USER_ID);
  });

  it('returns 401 for an invalid API key', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue({} as never);
    vi.mocked(resolveApiKey).mockResolvedValue(null);

    const req = new Request('http://localhost:3434/api/persona/voices', {
      headers: { Authorization: 'Bearer post-engineer_invalid' },
    });
    const res = await GET(req);

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 401 without a session', async () => {
    mockSession({ noSession: true });

    const res = await GET();

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 401 for a session without an access token', async () => {
    mockSession({ noToken: true });

    const res = await GET();

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 500 when MONEYPRINT_API_URL is not defined', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', '');

    const res = await GET();

    expect(res.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 502 when the engine fails', async () => {
    fetchMock.mockResolvedValue(new Response('erro', { status: 500 }));

    const res = await GET();

    expect(res.status).toBe(502);
  });

  it('returns 502 for an invalid voices payload', async () => {
    fetchMock.mockResolvedValue(Response.json({ status: 200, message: 'success', body: 'not-an-array' }));

    const res = await GET();

    expect(res.status).toBe(502);
  });

  it('returns 502 when the engine is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));

    const res = await GET();

    expect(res.status).toBe(502);
  });

  it('includes the exact error body on a configuration failure', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', '');

    const res = await GET();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      error: 'MONEYPRINT_API_URL is not defined',
    });
  });

  it('includes the exact error body when the engine fails', async () => {
    fetchMock.mockResolvedValue(new Response('erro', { status: 500 }));

    const res = await GET();

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ success: false, error: 'Voices unavailable.' });
  });

  it('includes the exact error body when the engine is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));

    const res = await GET();

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ success: false, error: 'Voices service unreachable.' });
  });

  it.each([
    ['body is not an array', 'not-an-array'],
    ['id is not a string', [{ id: 123 }]],
    ['null item', [null]],
    ['item is not an object', ['x']],
    ['item without id', [{}]],
    ['envelope without body', undefined],
  ])('returns 502 for an invalid voices payload (%s)', async (_label, body) => {
    fetchMock.mockResolvedValue(Response.json({ status: 200, message: 'success', body }));

    const res = await GET();

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ success: false, error: 'Invalid voices payload.' });
  });

  it('rejects the legacy envelope with a data key', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ status: 200, message: 'success', data: [voice('chatterbox:kokoro_af_heart')] }),
    );

    const res = await GET();

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ success: false, error: 'Invalid voices payload.' });
  });

  it('calls the engine endpoint without trailing slashes and with cache no-store', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://moneyprint.internal:8080///');
    fetchMock.mockResolvedValue(
      Response.json({ status: 200, message: 'success', body: [voice('chatterbox:kokoro_af_heart')] }),
    );

    const res = await GET();

    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://moneyprint.internal:8080/api/v1/personas/voices',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' });
  });

  it('projects only the catalog fields and drops extras', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        status: 200,
        message: 'success',
        body: [{ ...voice('chatterbox:kokoro_af_heart'), extra: 'ignored' }],
      }),
    );

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ voices: [voice('chatterbox:kokoro_af_heart')] });
  });

  it('returns 502 when a catalog entry has an unknown gender', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        status: 200,
        message: 'success',
        body: [{ ...voice('chatterbox:kokoro_af_heart'), gender: 'other' }],
      }),
    );

    const res = await GET();

    expect(res.status).toBe(502);
  });
});
