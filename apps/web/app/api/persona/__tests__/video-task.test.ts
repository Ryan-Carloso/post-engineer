import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

//---------------
// Testes de DELETE /api/persona/video-task/:taskId — cancela/remove task
// no motor. Auth = sessão Supabase.
//---------------

import { DELETE } from '../video-task/[taskId]/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const ACCESS_TOKEN = 'sb-task-token';
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

describe('DELETE /api/persona/video-task/:taskId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MONEYPRINT_API_URL', 'http://moneyprint.internal:8080');
    vi.stubEnv('MONEYPRINT_API_SECRET', API_SECRET);
    mockSession();
  });

  it('retorna 401 sem sessão', async () => {
    mockSession({ noSession: true });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await DELETE(
      new Request('http://localhost/api/persona/video-task/task-1', { method: 'DELETE' }) as never,
      { params: Promise.resolve({ taskId: 'task-1' }) },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retorna 401 com sessão sem access token', async () => {
    mockSession({ noToken: true });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await DELETE(
      new Request('http://localhost/api/persona/video-task/task-1', { method: 'DELETE' }) as never,
      { params: Promise.resolve({ taskId: 'task-1' }) },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cancela a task no motor com o token da sessão', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: 'deleted' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await DELETE(
      new Request('http://localhost/api/persona/video-task/task-1', { method: 'DELETE' }) as never,
      { params: Promise.resolve({ taskId: 'task-1' }) },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://moneyprint.internal:8080/api/v1/tasks/task-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers as HeadersInit);
    expect(headers.get('authorization')).toBe(`Bearer ${API_SECRET}`);
    expect(headers.get('x-api-key')).toBeNull();
    expect(headers.get('x-user-id')).toBe(USER_ID);
  });

  it('retorna 500 quando MONEYPRINT_API_URL não está definida', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', '');
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await DELETE(
      new Request('http://localhost/api/persona/video-task/task-1', { method: 'DELETE' }) as never,
      { params: Promise.resolve({ taskId: 'task-1' }) },
    );

    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retorna 502 quando o motor falha ou está indisponível', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('nope', { status: 500 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await DELETE(
      new Request('http://localhost/api/persona/video-task/task-1', { method: 'DELETE' }) as never,
      { params: Promise.resolve({ taskId: 'task-1' }) },
    );

    expect(response.status).toBe(502);

    const fetchReject = vi.fn<typeof fetch>().mockRejectedValue(new Error('refused'));
    vi.stubGlobal('fetch', fetchReject);

    const response2 = await DELETE(
      new Request('http://localhost/api/persona/video-task/task-1', { method: 'DELETE' }) as never,
      { params: Promise.resolve({ taskId: 'task-1' }) },
    );

    expect(response2.status).toBe(502);
  });
});
