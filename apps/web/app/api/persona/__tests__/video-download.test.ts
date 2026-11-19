import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@/lib/api-keys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-keys')>();
  return {
    ...actual,
    resolveApiKey: vi.fn(),
    validateApiKeyFormat: (key: string) => key.startsWith('post-engineer_'),
  };
});

import { GET } from '../video-download/[taskId]/[...path]/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { resolveApiKey } from '@/lib/api-keys';

const ACCESS_TOKEN = 'sb-download-token';
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

const params = (taskId: string, path: string[]): { params: Promise<{ taskId: string; path: string[] }> } => ({
  params: Promise.resolve({ taskId, path }),
});

describe('GET /api/persona/video-download/:taskId/*path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MONEYPRINT_API_URL', 'http://moneyprint.internal:8080');
    vi.stubEnv('MONEYPRINT_API_SECRET', API_SECRET);
    mockSession();
  });

  it('returns 401 without a session and does not contact the engine', async () => {
    mockSession({ noSession: true });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new Request('http://localhost/download') as never, params('task-1', ['final.mp4']));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the session has no access token', async () => {
    mockSession({ noToken: true });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new Request('http://localhost/download') as never, params('task-1', ['final.mp4']));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects path traversal and invalid file names', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const traversal = await GET(new Request('http://localhost/download') as never, params('task-1', ['..', 'secret.mp4']));
    const invalidFilename = await GET(new Request('http://localhost/download') as never, params('task-1', ['final?.mp4']));

    expect(traversal.status).toBe(400);
    expect(invalidFilename.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('streams the upstream binary with the session token and safe headers', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('video bytes', {
      status: 206,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': '11',
        'Content-Range': 'bytes 0-10/20',
        'Accept-Ranges': 'bytes',
        'Set-Cookie': 'should-not-forward=1',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://localhost/download', { headers: { Range: 'bytes=0-10' } }) as never,
      params('task-1', ['final.mp4']),
    );

    expect(response.status).toBe(206);
    expect(await response.text()).toBe('video bytes');
    expect(response.headers.get('Content-Type')).toBe('video/mp4');
    expect(response.headers.get('Content-Length')).toBe('11');
    expect(response.headers.get('Content-Range')).toBe('bytes 0-10/20');
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://moneyprint.internal:8080/api/v1/download/task-1/final.mp4',
      expect.objectContaining({ headers: expect.objectContaining({ Range: 'bytes=0-10' }) }),
    );
    const sentHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers as HeadersInit);
    expect(sentHeaders.get('authorization')).toBe(`Bearer ${API_SECRET}`);
    expect(sentHeaders.get('x-api-key')).toBeNull();
    expect(sentHeaders.get('x-user-id')).toBe(USER_ID);
  });

  it('returns 502 when the engine is unavailable', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('refused'));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new Request('http://localhost/download') as never, params('task-1', ['final.mp4']));

    expect(response.status).toBe(502);
  });

  it('returns 500 when MONEYPRINT_API_URL is not defined', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', '');
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new Request('http://localhost/download') as never, params('task-1', ['final.mp4']));

    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts an API key via x-api-key without a web session', async () => {
    mockSession({ noSession: true });
    vi.mocked(createSupabaseServiceClient).mockReturnValue({} as never);
    vi.mocked(resolveApiKey).mockResolvedValue({
      userId: USER_ID,
      keyId: 'key-1',
      personaIds: null,
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('video bytes', {
      status: 200,
      headers: { 'Content-Type': 'video/mp4' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://localhost/download', {
        headers: { 'x-api-key': 'post-engineer_testkey123' },
      }) as never,
      params('task-1', ['final.mp4']),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('video bytes');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('returns 401 for an invalid API key', async () => {
    mockSession({ noSession: true });
    vi.mocked(createSupabaseServiceClient).mockReturnValue({} as never);
    vi.mocked(resolveApiKey).mockResolvedValue(null);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://localhost/download', {
        headers: { 'x-api-key': 'post-engineer_invalidkey' },
      }) as never,
      params('task-1', ['final.mp4']),
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
