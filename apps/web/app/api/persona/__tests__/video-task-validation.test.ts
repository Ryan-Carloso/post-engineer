import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

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

describe('DELETE /api/persona/video-task/:taskId — taskId validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MONEYPRINT_API_URL', 'http://moneyprint.internal:8080');
    vi.stubEnv('MONEYPRINT_API_SECRET', API_SECRET);
    mockSession();
  });

  it('retorna 400 quando taskId contém caracteres inválidos (ex: ../)', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await DELETE(
      new Request('http://localhost/api/persona/video-task/../../etc/passwd', { method: 'DELETE' }) as never,
      { params: Promise.resolve({ taskId: '../../etc/passwd' }) },
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retorna 400 quando taskId é vazio', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await DELETE(
      new Request('http://localhost/api/persona/video-task/', { method: 'DELETE' }) as never,
      { params: Promise.resolve({ taskId: '' }) },
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retorna 400 quando taskId tem mais de 128 caracteres', async () => {
    const longTaskId = 'a'.repeat(129);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await DELETE(
      new Request(`http://localhost/api/persona/video-task/${longTaskId}`, { method: 'DELETE' }) as never,
      { params: Promise.resolve({ taskId: longTaskId }) },
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aceita taskId válido (alphanum + ._-)', async () => {
    const validTaskIds = ['task-1', 'task_1', 'task.1', 'Task1', 't1'];
    for (const taskId of validTaskIds) {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ status: 'deleted' }), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const response = await DELETE(
        new Request(`http://localhost/api/persona/video-task/${taskId}`, { method: 'DELETE' }) as never,
        { params: Promise.resolve({ taskId }) },
      );

      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalled();
    }
  });
});
