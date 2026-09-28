import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

//---------------
// Tests for GET /api/persona/video-events/:taskId — SSE progress proxy.
// Auth = Supabase session; the route pipes the engine's
// /api/v1/tasks/:taskId/events stream without buffering it.
//---------------

import { GET } from '../video-events/[taskId]/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const ACCESS_TOKEN = 'test-access-token';
const API_SECRET = 'test-api-secret';

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

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe('GET /api/persona/video-events/:taskId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MONEYPRINT_API_URL', 'http://moneyprint.internal:8080');
    vi.stubEnv('MONEYPRINT_API_SECRET', API_SECRET);
    mockSession();
  });

  it('returns 401 without a session', async () => {
    mockSession({ noSession: true });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://localhost/api/persona/video-events/task-1') as never,
      { params: Promise.resolve({ taskId: 'task-1' }) },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid taskId', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://localhost/api/persona/video-events/..%2F..') as never,
      { params: Promise.resolve({ taskId: '../../etc' }) },
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pipes the engine SSE stream with event-stream content type', async () => {
    const chunks = [
      'data: {"task_id":"task-1","state":4,"progress":30,"stage":"materials"}\n\n',
      ':heartbeat\n\n',
      'data: {"task_id":"task-1","state":1,"progress":100,"stage":null}\n\n',
    ];
    const fetchMock = vi.fn(async () =>
      new Response(sseStream(chunks), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://localhost/api/persona/video-events/task-1') as never,
      { params: Promise.resolve({ taskId: 'task-1' }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(fetchMock).toHaveBeenCalledOnce();
    const firstCall = vi.mocked(fetchMock).mock.calls[0] as unknown as [input: unknown];
    const upstreamUrl = new URL(String(firstCall[0]));
    expect(upstreamUrl.pathname).toBe('/api/v1/tasks/task-1/events');

    const text = await response.text();
    expect(text).toBe(chunks.join(''));
  });

  it('returns the upstream status when the engine rejects the stream', async () => {
    const fetchMock = vi.fn(async () => new Response('not found', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://localhost/api/persona/video-events/missing') as never,
      { params: Promise.resolve({ taskId: 'missing' }) },
    );

    expect(response.status).toBe(404);
  });

  it('returns 500 without MONEYPRINT_API_URL', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', '');
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://localhost/api/persona/video-events/task-1') as never,
      { params: Promise.resolve({ taskId: 'task-1' }) },
    );

    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
