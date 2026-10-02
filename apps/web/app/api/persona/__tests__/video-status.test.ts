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

//---------------
// Tests for GET /api/persona/video-status/:taskId — engine status proxy.
// Auth = Supabase session.
//---------------

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

describe('GET /api/persona/video-status/:taskId', () => {
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
      new Response(JSON.stringify({ data: { videos: ['/api/v1/download/task-1/final.mp4', '/api/v1/stream/task-1/final.mp4'] } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://localhost/api/persona/video-status/task-1') as never,
      { params: Promise.resolve({ taskId: 'task-1' }) },
    );

    const body = await response.json() as { data: { videos: string[] } };
    expect(body.data.videos).toEqual([
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
      // `unknown` fields: the idempotency gate must narrow whatever the DB
      // returns — tests feed malformed rows to lock that in.
      historyRow: { status: unknown; tokens_refunded: unknown } | null = null,
    ) {
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
      // The route issues two queries: the charge lookup on
      // token_transactions and (new, review MINOR) the idempotency read on
      // video_generations. Route them by table name.
      const from = vi.fn().mockImplementation((table: string) => ({
        select: table === 'video_generations' ? historySelect : chargeSelect,
      }));
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

    async function poll(taskId = 'task-1') {
      return GET(new Request(`http://localhost/api/persona/video-status/${taskId}`) as never, {
        params: Promise.resolve({ taskId }),
      });
    }

    it('records a failed generation with the engine error and refunds on numeric state -1', async () => {
      // Real engine shape: the task sits under `data` and `state` is numeric
      // (-1 failed, 1 complete, 3 queued, 4 processing).
      mockTaskBody({
        status: 200,
        message: 'success',
        data: { task_id: 'task-1', state: -1, error: 'custom audio file is invalid: boom' },
      });
      const serviceClient = mockServiceClient('gen-1');
      // The refund RPC succeeded, so the flag is written and the next poll
      // skips the terminal side effects.
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
      // Review round 5 (opencode): the route used to write
      // tokensRefunded: true unconditionally. A failed refund then looked
      // recorded and the "next poll must retry that refund" backstop above
      // could never fire — the user's tokens were silently lost.
      mockTaskBody({
        status: 200,
        message: 'success',
        data: { task_id: 'task-1', state: -1, error: 'boom' },
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
        data: { task_id: 'task-1', state: 1, progress: 100 },
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

    it('leaves history and tokens alone on a non-terminal numeric state', async () => {
      mockTaskBody({
        status: 200,
        message: 'success',
        data: { task_id: 'task-1', state: 4, progress: 42 },
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
      // Review MINOR: taskState parses /^-?\d+$/ strings, but only native
      // JSON numbers were exercised — lock the string branch in.
      mockTaskBody({
        status: 200,
        message: 'success',
        data: { task_id: 'task-1', state: '-1', error: 'boom' },
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
      // Review MINOR: repeat polls of an already-terminal task re-ran the
      // charge lookup, the refund RPC and the history update — re-stamping
      // completed_at to "last poll time". A recorded + refunded failure is
      // a no-op.
      mockTaskBody({
        status: 200,
        message: 'success',
        data: { task_id: 'task-1', state: -1, error: 'boom' },
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
        data: { task_id: 'task-1', state: 1, progress: 100 },
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
      // Edge case the skip must not swallow: the first poll recorded the
      // failure while the refund RPC failed — the next poll must retry it.
      mockTaskBody({
        status: 200,
        message: 'success',
        data: { task_id: 'task-1', state: -1, error: 'boom' },
      });
      const serviceClient = mockServiceClient('gen-1', { status: 'failed', tokens_refunded: false });
      // The retry lands, so the flag is written this time.
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
      // Review MINOR round 2: the idempotency gate narrows the history
      // row's types explicitly. A malformed row (non-string status,
      // non-boolean tokens_refunded) must not crash the gate and must not
      // silently count as a recorded terminal state — the gate opens and
      // the terminal side effects run.
      mockTaskBody({
        status: 200,
        message: 'success',
        data: { task_id: 'task-1', state: -1, error: 'boom' },
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
        data: { task_id: 'task-1', state: -1, error: 'boom' },
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
      // Billing ownership model (legacy): videos created through the removed
      // batch endpoint (POST /api/persona/video-batch, deleted with the
      // unified generate+schedule refactor) were charged upfront by the ENGINE
      // under `persona-batch:<id>:video:<n>` generation ids. The engine
      // never attaches engine_task_id to those charge rows, so this
      // proxy's token_transactions lookup finds nothing — and it must
      // stay that way: a web-side refund here would double-refund the
      // engine's own failure refund for those legacy batch tasks.
      mockTaskBody({
        status: 200,
        data: { task_id: 'task-1', state: -1, error: 'boom' },
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
  });
});
