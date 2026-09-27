// @vitest-environment node
// Rota de API usa Response/Blob/fetch nativos (undici); o jsdom mistura
// implementações e quebra `new Response(new Blob(...))` (object.stream
// is not a function). Testes de UI ficam no jsdom.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/request-auth', () => ({
  engineAuthHeaders: () => ({ Authorization: 'Bearer secret', 'x-user-id': 'user-1' }),
  requireSupabaseSession: vi.fn(async () => ({ auth: { userId: 'user-1', accessToken: 'token' }, error: null })),
}));

import { GET } from '../video-download/[taskId]/[...path]/route';

describe('GET /api/persona/video-download/:taskId/...path — taskId validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MONEYPRINT_API_URL', 'http://moneyprint.internal:8080');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'engine-shared-secret');
  });

  it('retorna 400 quando taskId contém caracteres inválidos (ex: ../)', async () => {
    const response = await GET(
      new Request('http://localhost/api/persona/video-download/../../etc/passwd/final.mp4') as never,
      { params: Promise.resolve({ taskId: '../../etc/passwd', path: ['final.mp4'] }) },
    );

    expect(response.status).toBe(400);
  });

  it('retorna 400 quando taskId é vazio', async () => {
    const response = await GET(
      new Request('http://localhost/api/persona/video-download//final.mp4') as never,
      { params: Promise.resolve({ taskId: '', path: ['final.mp4'] }) },
    );

    expect(response.status).toBe(400);
  });

  it('retorna 400 quando taskId tem mais de 128 caracteres', async () => {
    const longTaskId = 'a'.repeat(129);
    const response = await GET(
      new Request(`http://localhost/api/persona/video-download/${longTaskId}/final.mp4`) as never,
      { params: Promise.resolve({ taskId: longTaskId, path: ['final.mp4'] }) },
    );

    expect(response.status).toBe(400);
  });

  it('aceita taskId válido (alphanum + ._-)', async () => {
    const validTaskIds = ['task-1', 'task_1', 'task.1', 'Task1', 't1'];
    for (const taskId of validTaskIds) {
      // Mock fetch to return a video response
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(new Blob(['video']), { status: 200, headers: { 'content-type': 'video/mp4' } }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const response = await GET(
        new Request(`http://localhost/api/persona/video-download/${taskId}/final.mp4`) as never,
        { params: Promise.resolve({ taskId, path: ['final.mp4'] }) },
      );

      expect(response.status).toBe(200);
    }
  });
});
