import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@/lib/billing/token-check', () => ({
  refundTokens: vi.fn(),
}));

import { GET } from '../video-status/[taskId]/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { refundTokens } from '@/lib/billing/token-check';
import * as videoGeneration from '@/lib/generation/video-generation';

const ACCESS_TOKEN = 'sb-status-token';
const API_SECRET = 'engine-shared-secret';
const USER_ID = 'user-1';

function mockSession(opts?: { noSession?: boolean; noToken?: boolean }): void {
  const client = {
    auth: {
      getClaims: vi.fn(async () =>
        opts?.noSession
          ? { data: null, error: null }
          : { data: { claims: { sub: 'user-1' } }, error: null },
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

describe('GET /api/persona/video-status/:taskId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MONEYPRINT_API_URL', 'http://moneyprint.internal:8080');
    vi.stubEnv('MONEYPRINT_API_SECRET', API_SECRET);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://post-engineer.com');
    mockSession();
  });

  it('retorna 401 sem sessão', async () => {
    mockSession({ noSession: true });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://localhost/api/persona/video-status/task-1') as never,
      { params: Promise.resolve({ taskId: 'task-1' }) },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retorna 401 com sessão sem access token', async () => {
    mockSession({ noToken: true });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://localhost/api/persona/video-status/task-1') as never,
      { params: Promise.resolve({ taskId: 'task-1' }) },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('encaminha o access token da sessão como Authorization Bearer', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: 'finished' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://localhost/api/persona/video-status/task-1') as never,
      { params: Promise.resolve({ taskId: 'task-1' }) },
    );

    expect(response.status).toBe(200);
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers as HeadersInit);
    expect(headers.get('authorization')).toBe(`Bearer ${API_SECRET}`);
    expect(headers.get('x-api-key')).toBeNull();
    expect(headers.get('x-user-id')).toBe(USER_ID);
  });

  it('reescrita das URLs relativas de download/stream para o proxy autenticado do Next', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ body: { videos: ['/api/v1/download/task-1/final.mp4', '/api/v1/stream/task-1/final.mp4'] } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://localhost/api/persona/video-status/task-1') as never,
      { params: Promise.resolve({ taskId: 'task-1' }) },
    );

    const body = await response.json() as { body: { videos: string[] } };
    expect(body.body.videos).toEqual([
      '/api/persona/video-download/task-1/final.mp4',
      '/api/persona/video-download/task-1/final.mp4?source=stream',
    ]);
  });

  it('retorna 500 quando MONEYPRINT_API_URL não está definida', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', '');
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://localhost/api/persona/video-status/task-1') as never,
      { params: Promise.resolve({ taskId: 'task-1' }) },
    );

    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retorna 502 quando o motor está indisponível', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('refused'));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://localhost/api/persona/video-status/task-1') as never,
      { params: Promise.resolve({ taskId: 'task-1' }) },
    );

    expect(response.status).toBe(502);
  });

  it('retorna 502 quando o motor rejeita a consulta', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('nope', { status: 500 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://localhost/api/persona/video-status/task-1') as never,
      { params: Promise.resolve({ taskId: 'task-1' }) },
    );

    expect(response.status).toBe(502);
  });

  describe('generation history recording', () => {
    function mockServiceClient(
      generationId: string | null,
      historyRow: { status: unknown; tokens_refunded: unknown } | null = null,
      fallbackGenerationId: string | null = null,
      durableTask: { state?: number; data?: unknown; error?: unknown } | null = null,
      publishedSlot: boolean = false,
    ) {
      const durableSingle = vi
        .fn()
        .mockResolvedValue({
          data:
            durableTask && durableTask.state !== undefined
              ? { state: durableTask.state, data: durableTask.data ?? {} }
              : null,
          error: durableTask?.error ?? null,
        });
      const durableLimit = vi.fn().mockReturnValue({ maybeSingle: durableSingle });
      const durableEq2 = vi.fn().mockReturnValue({ limit: durableLimit });
      const durableEq1 = vi.fn().mockReturnValue({ eq: durableEq2 });
      const durableSelect = vi.fn().mockReturnValue({ eq: durableEq1 });
      const publishedLimit = vi
        .fn()
        .mockResolvedValue({ data: publishedSlot ? [{ id: 'slot-1' }] : [], error: null });
      const publishedSingle = vi
        .fn()
        .mockResolvedValue({ data: publishedSlot ? { id: 'slot-1' } : null, error: null });
      const publishedEq3 = vi.fn().mockReturnValue({ limit: publishedLimit, maybeSingle: publishedSingle });
      const publishedEq2 = vi.fn().mockReturnValue({ eq: publishedEq3, maybeSingle: publishedSingle });
      const publishedEq1 = vi.fn().mockReturnValue({ eq: publishedEq2 });
      const publishedSelect = vi.fn().mockReturnValue({ eq: publishedEq1 });
      const chargeSingle = vi
        .fn()
        .mockResolvedValue({ data: generationId ? { generation_id: generationId } : null, error: null });
      const historySingle = vi
        .fn()
        .mockResolvedValue({ data: historyRow, error: null });
      const chargeEq3 = vi.fn().mockReturnValue({ maybeSingle: chargeSingle });
      const chargeEq2 = vi.fn().mockReturnValue({ eq: chargeEq3 });
      const chargeEq1 = vi.fn().mockReturnValue({ eq: chargeEq2 });
      const chargeSelect = vi.fn().mockReturnValue({ eq: chargeEq1 });
      const historyEq = vi.fn().mockReturnValue({ maybeSingle: historySingle });
      const historySelect = vi.fn().mockReturnValue({ eq: historyEq });
      const fallbackSingle = vi
        .fn()
        .mockResolvedValue({
          data: fallbackGenerationId ? { generation_id: fallbackGenerationId } : null,
          error: null,
        });
      const fallbackLimit = vi.fn().mockReturnValue({ maybeSingle: fallbackSingle });
      const fallbackEq2 = vi.fn().mockReturnValue({ limit: fallbackLimit });
      const fallbackEq1 = vi.fn().mockReturnValue({ eq: fallbackEq2 });
      const fallbackSelect = vi.fn().mockReturnValue({ eq: fallbackEq1 });
      let videoGenerationCalls = 0;
      const from = vi.fn().mockImplementation((table: string) => {
        if (table !== 'video_generations') {
          if (table === 'engine_task_state') return { select: durableSelect };
          if (table === 'scheduled_posts') return { select: publishedSelect };
          return { select: chargeSelect };
        }
        videoGenerationCalls += 1;
        const useFallback = generationId === null && videoGenerationCalls === 1;
        return { select: useFallback ? fallbackSelect : historySelect };
      });
      const client = { from };
      vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
      return client;
    }

    function mockTaskBody(body: unknown, status = 200) {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(body), { status }));
      vi.stubGlobal('fetch', fetchMock);
    }

    async function poll(taskId = 'task-1', origin = 'http://localhost') {
      return GET(new Request(`${origin}/api/persona/video-status/${taskId}`) as never, {
        params: Promise.resolve({ taskId }),
      });
    }

    it('records a failed generation with the engine error and refunds on numeric state -1', async () => {
      mockTaskBody({
        status: 200,
        message: 'success',
        body: { task_id: 'task-1', state: -1, error: 'custom audio file is invalid: boom' },
      });
      const serviceClient = mockServiceClient('gen-1');
      vi.mocked(refundTokens).mockResolvedValue(true);
      const updateSpy = vi
        .spyOn(videoGeneration, 'recordGenerationUpdate')
        .mockResolvedValue(undefined);
      try {
        const response = await poll();
        expect(response.status).toBe(200);
        expect(refundTokens).toHaveBeenCalledWith(serviceClient, USER_ID, 'gen-1');
        expect(updateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            generationId: 'gen-1',
            status: 'failed',
            engineTaskId: 'task-1',
            errorCode: 'custom_audio_invalid',
            errorMessage: 'custom audio file is invalid: boom',
            tokensRefunded: true,
          }),
        );
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('leaves tokens_refunded unset when the refund RPC fails so the next poll retries', async () => {
      mockTaskBody({
        status: 200,
        message: 'success',
        body: { task_id: 'task-1', state: -1, error: 'boom' },
      });
      mockServiceClient('gen-1');
      vi.mocked(refundTokens).mockResolvedValue(false);
      const updateSpy = vi
        .spyOn(videoGeneration, 'recordGenerationUpdate')
        .mockResolvedValue(undefined);
      try {
        const response = await poll();
        expect(response.status).toBe(200);
        expect(refundTokens).toHaveBeenCalled();
        expect(updateSpy).toHaveBeenCalledWith(
          expect.objectContaining({ generationId: 'gen-1', status: 'failed' }),
        );
        expect(updateSpy).toHaveBeenCalledWith(
          expect.not.objectContaining({ tokensRefunded: true }),
        );
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('records a completed generation without refunding on numeric state 1', async () => {
      mockTaskBody({
        status: 200,
        message: 'success',
        body: { task_id: 'task-1', state: 1, progress: 100 },
      });
      mockServiceClient('gen-1');
      const updateSpy = vi
        .spyOn(videoGeneration, 'recordGenerationUpdate')
        .mockResolvedValue(undefined);
      try {
        const response = await poll();
        expect(response.status).toBe(200);
        expect(refundTokens).not.toHaveBeenCalled();
        expect(updateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            generationId: 'gen-1',
            status: 'completed',
            engineTaskId: 'task-1',
          }),
        );
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('includes postUrl from the public app URL even when the request comes from the proxy origin', async () => {
      mockTaskBody({
        status: 200,
        message: 'success',
        body: { task_id: 'task-1', state: 1, progress: 100 },
      });
      mockServiceClient('gen-1', null, null, null, true);
      const updateSpy = vi
        .spyOn(videoGeneration, 'recordGenerationUpdate')
        .mockResolvedValue(undefined);
      try {
        const response = await poll('task-1', 'http://0.0.0.0:3000');
        expect(response.status).toBe(200);
        const envelope = (await response.json()) as {
          body: { postUrl: string | null };
          postUrl?: unknown;
        };
        expect(envelope.body.postUrl).toBe('https://post-engineer.com/posts/slot-1');
        expect(envelope.postUrl).toBeUndefined();
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('returns a null postUrl when the task has no slot', async () => {
      mockTaskBody({
        status: 200,
        message: 'success',
        body: { task_id: 'task-1', state: 1, progress: 100 },
      });
      mockServiceClient('gen-1');
      const updateSpy = vi
        .spyOn(videoGeneration, 'recordGenerationUpdate')
        .mockResolvedValue(undefined);
      try {
        const response = await poll();
        expect(response.status).toBe(200);
        const envelope = (await response.json()) as {
          body: { postUrl: string | null };
          postUrl?: unknown;
        };
        expect(envelope.body.postUrl).toBeNull();
        expect(envelope.postUrl).toBeUndefined();
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('leaves history and tokens alone on a non-terminal numeric state', async () => {
      mockTaskBody({
        status: 200,
        message: 'success',
        body: { task_id: 'task-1', state: 4, progress: 42 },
      });
      mockServiceClient('gen-1');
      const updateSpy = vi
        .spyOn(videoGeneration, 'recordGenerationUpdate')
        .mockResolvedValue(undefined);
      try {
        const response = await poll();
        expect(response.status).toBe(200);
        expect(refundTokens).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('still recognizes string terminal states as a fallback', async () => {
      mockTaskBody({ status: 'failed', error: 'boom' });
      mockServiceClient('gen-1');
      const updateSpy = vi
        .spyOn(videoGeneration, 'recordGenerationUpdate')
        .mockResolvedValue(undefined);
      try {
        const response = await poll();
        expect(response.status).toBe(200);
        expect(refundTokens).toHaveBeenCalled();
        expect(updateSpy).toHaveBeenCalledWith(
          expect.objectContaining({ generationId: 'gen-1', status: 'failed' }),
        );
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('recognizes numeric states delivered as strings', async () => {
      mockTaskBody({
        status: 200,
        message: 'success',
        body: { task_id: 'task-1', state: '-1', error: 'boom' },
      });
      mockServiceClient('gen-1');
      const updateSpy = vi
        .spyOn(videoGeneration, 'recordGenerationUpdate')
        .mockResolvedValue(undefined);
      try {
        const response = await poll();
        expect(response.status).toBe(200);
        expect(refundTokens).toHaveBeenCalled();
        expect(updateSpy).toHaveBeenCalledWith(
          expect.objectContaining({ generationId: 'gen-1', status: 'failed' }),
        );
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('does not re-run terminal side effects when the failure is already recorded and refunded', async () => {
      mockTaskBody({
        status: 200,
        message: 'success',
        body: { task_id: 'task-1', state: -1, error: 'boom' },
      });
      mockServiceClient('gen-1', { status: 'failed', tokens_refunded: true });
      const updateSpy = vi
        .spyOn(videoGeneration, 'recordGenerationUpdate')
        .mockResolvedValue(undefined);
      try {
        const response = await poll();
        expect(response.status).toBe(200);
        expect(refundTokens).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('does not re-run terminal side effects when the completion is already recorded', async () => {
      mockTaskBody({
        status: 200,
        message: 'success',
        body: { task_id: 'task-1', state: 1, progress: 100 },
      });
      mockServiceClient('gen-1', { status: 'completed', tokens_refunded: false });
      const updateSpy = vi
        .spyOn(videoGeneration, 'recordGenerationUpdate')
        .mockResolvedValue(undefined);
      try {
        const response = await poll();
        expect(response.status).toBe(200);
        expect(refundTokens).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('still retries the refund when the failure was recorded but not refunded', async () => {
      mockTaskBody({
        status: 200,
        message: 'success',
        body: { task_id: 'task-1', state: -1, error: 'boom' },
      });
      const serviceClient = mockServiceClient('gen-1', { status: 'failed', tokens_refunded: false });
      vi.mocked(refundTokens).mockResolvedValue(true);
      const updateSpy = vi
        .spyOn(videoGeneration, 'recordGenerationUpdate')
        .mockResolvedValue(undefined);
      try {
        const response = await poll();
        expect(response.status).toBe(200);
        expect(refundTokens).toHaveBeenCalledWith(serviceClient, USER_ID, 'gen-1');
        expect(updateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            generationId: 'gen-1',
            status: 'failed',
            tokensRefunded: true,
          }),
        );
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('treats a malformed history row as not-yet-terminal and re-runs side effects', async () => {
      mockTaskBody({
        status: 200,
        message: 'success',
        body: { task_id: 'task-1', state: -1, error: 'boom' },
      });
      mockServiceClient('gen-1', { status: 1, tokens_refunded: 'yes' });
      const updateSpy = vi
        .spyOn(videoGeneration, 'recordGenerationUpdate')
        .mockResolvedValue(undefined);
      try {
        const response = await poll();
        expect(response.status).toBe(200);
        expect(refundTokens).toHaveBeenCalled();
        expect(updateSpy).toHaveBeenCalledWith(
          expect.objectContaining({ generationId: 'gen-1', status: 'failed' }),
        );
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('skips history recording when no charge row links the task', async () => {
      mockTaskBody({
        status: 200,
        body: { task_id: 'task-1', state: -1, error: 'boom' },
      });
      mockServiceClient(null);
      const updateSpy = vi
        .spyOn(videoGeneration, 'recordGenerationUpdate')
        .mockResolvedValue(undefined);
      try {
        const response = await poll();
        expect(response.status).toBe(200);
        expect(refundTokens).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('never refunds engine-billed batch tasks: the engine owns that ledger', async () => {
      mockTaskBody({
        status: 200,
        body: { task_id: 'task-1', state: -1, error: 'boom' },
      });
      mockServiceClient(null);
      const updateSpy = vi
        .spyOn(videoGeneration, 'recordGenerationUpdate')
        .mockResolvedValue(undefined);
      try {
        const response = await poll();
        expect(response.status).toBe(200);
        expect(refundTokens).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('treats an engine 404 as terminal: records the failure with engine_restart and refunds', async () => {
      mockTaskBody({ status: 404, message: 'req-1: task not found' }, 404);
      const serviceClient = mockServiceClient('gen-1');
      vi.mocked(refundTokens).mockResolvedValue(true);
      const updateSpy = vi
        .spyOn(videoGeneration, 'recordGenerationUpdate')
        .mockResolvedValue(undefined);
      try {
        const response = await poll();
        expect(response.status).toBe(410);
        const body = await response.json();
        expect(body).toMatchObject({ success: false, terminal: true });
        expect(body.delivered).toBeUndefined();
        expect(refundTokens).toHaveBeenCalledWith(serviceClient, USER_ID, 'gen-1');
        expect(updateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            generationId: 'gen-1',
            status: 'failed',
            engineTaskId: 'task-1',
            errorCode: 'engine_restart',
            errorMessage: 'req-1: task not found',
            tokensRefunded: true,
          }),
        );
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('backfills completed on an engine 404 when a published slot proves delivery (MAJOR 1)', async () => {
      mockTaskBody({ status: 404, message: 'req-1: task not found' }, 404);
      const serviceClient = mockServiceClient('gen-1', null, null, null, true);
      const updateSpy = vi
        .spyOn(videoGeneration, 'recordGenerationUpdate')
        .mockResolvedValue(undefined);
      try {
        const response = await poll();
        expect(response.status).toBe(410);
        expect(await response.json()).toMatchObject({
          success: false,
          terminal: true,
          delivered: true,
          postUrl: 'https://post-engineer.com/posts/slot-1',
        });
        expect(updateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            generationId: 'gen-1',
            status: 'completed',
            engineTaskId: 'task-1',
          }),
        );
        expect(refundTokens).not.toHaveBeenCalledWith(serviceClient, USER_ID, 'gen-1');
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('does NOT record a failure on an engine 404 when the durable read itself errors (unverifiable is not failed)', async () => {
      mockTaskBody({ status: 404, message: 'req-1: task not found' }, 404);
      const serviceClient = mockServiceClient(
        'gen-1',
        null,
        null,
        { error: { message: 'connection reset' } },
      );
      const updateSpy = vi
        .spyOn(videoGeneration, 'recordGenerationUpdate')
        .mockResolvedValue(undefined);
      try {
        const response = await poll();
        expect(response.status).toBe(502);
        expect(updateSpy).not.toHaveBeenCalled();
        expect(refundTokens).not.toHaveBeenCalledWith(serviceClient, USER_ID, 'gen-1');
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('backfills completed on an engine 404 when the durable task state proves the render finished', async () => {
      mockTaskBody({ status: 404, message: 'req-1: task not found' }, 404);
      const serviceClient = mockServiceClient('gen-1', null, null, {
        state: 1,
        data: { videos: ['render/final-1.mp4'] },
      });
      const updateSpy = vi
        .spyOn(videoGeneration, 'recordGenerationUpdate')
        .mockResolvedValue(undefined);
      try {
        const response = await poll();
        expect(response.status).toBe(410);
        expect(await response.json()).toMatchObject({
          success: false,
          terminal: true,
          delivered: true,
        });
        expect(updateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            generationId: 'gen-1',
            status: 'completed',
            engineTaskId: 'task-1',
          }),
        );
        expect(refundTokens).not.toHaveBeenCalledWith(
          serviceClient,
          USER_ID,
          'gen-1',
        );
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('does not re-run terminal side effects when a 404 arrives for an already-recorded and refunded failure', async () => {
      mockTaskBody({ status: 404, message: 'req-1: task not found' }, 404);
      mockServiceClient('gen-1', { status: 'failed', tokens_refunded: true });
      const updateSpy = vi
        .spyOn(videoGeneration, 'recordGenerationUpdate')
        .mockResolvedValue(undefined);
      try {
        const response = await poll();
        expect(response.status).toBe(410);
        expect(await response.json()).toMatchObject({ terminal: true });
        expect(refundTokens).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('still retries the refund when the 404 failure was recorded but not refunded', async () => {
      mockTaskBody({ status: 404, message: 'req-1: task not found' }, 404);
      const serviceClient = mockServiceClient('gen-1', { status: 'failed', tokens_refunded: false });
      vi.mocked(refundTokens).mockResolvedValue(true);
      const updateSpy = vi
        .spyOn(videoGeneration, 'recordGenerationUpdate')
        .mockResolvedValue(undefined);
      try {
        const response = await poll();
        expect(response.status).toBe(410);
        expect(refundTokens).toHaveBeenCalledWith(serviceClient, USER_ID, 'gen-1');
        expect(updateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            generationId: 'gen-1',
            status: 'failed',
            errorCode: 'engine_restart',
            tokensRefunded: true,
          }),
        );
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('answers terminal on 404 without touching history when no charge row links the task', async () => {
      mockTaskBody({ status: 404, message: 'req-1: task not found' }, 404);
      mockServiceClient(null);
      const updateSpy = vi
        .spyOn(videoGeneration, 'recordGenerationUpdate')
        .mockResolvedValue(undefined);
      try {
        const response = await poll();
        expect(response.status).toBe(410);
        expect(await response.json()).toMatchObject({ success: false, terminal: true });
        expect(refundTokens).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('records the failure for a scheduled post whose batch charge carries no task id', async () => {
      mockTaskBody({ status: 404, message: 'req-1: task not found' }, 404);
      const serviceClient = mockServiceClient(null, null, 'batch:sched-1:slot:slot-9');
      vi.mocked(refundTokens).mockResolvedValue(true);
      const updateSpy = vi
        .spyOn(videoGeneration, 'recordGenerationUpdate')
        .mockResolvedValue(undefined);
      try {
        const response = await poll();
        expect(response.status).toBe(410);
        expect(updateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            generationId: 'batch:sched-1:slot:slot-9',
            status: 'failed',
            engineTaskId: 'task-1',
            errorCode: 'engine_restart',
          }),
        );
        expect(refundTokens).not.toHaveBeenCalled();
        const patch = updateSpy.mock.calls[0][0];
        expect(patch.tokensRefunded).toBeUndefined();
        expect(serviceClient).toBeDefined();
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('does not touch history when neither the charge nor the task id resolves a generation', async () => {
      mockTaskBody({ status: 404, message: 'req-1: task not found' }, 404);
      mockServiceClient(null, null, null);
      const updateSpy = vi
        .spyOn(videoGeneration, 'recordGenerationUpdate')
        .mockResolvedValue(undefined);
      try {
        const response = await poll();
        expect(response.status).toBe(410);
        expect(updateSpy).not.toHaveBeenCalled();
      } finally {
        updateSpy.mockRestore();
      }
    });
  });
});
