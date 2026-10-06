import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  attachGenerationTask,
  gateGeneration,
  refundFailedGeneration,
  startEngineVideoTask,
  uploadEngineTempAsset,
} from '../video-generation';
import { checkAndDeductTokens, refundTokens } from '@/lib/billing/token-check';
import { logger } from '@/lib/logger';

vi.mock('@/lib/billing/token-check', () => ({
  checkAndDeductTokens: vi.fn(),
  refundTokens: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockCheckAndDeduct = vi.mocked(checkAndDeductTokens);
const mockRefund = vi.mocked(refundTokens);
const logError = vi.mocked(logger.error);

function mockSupabase() {
  return { from: vi.fn() } as unknown as SupabaseClient;
}

function engineResponse(payload: string, status = 200): Response {
  return new Response(payload, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('gateGeneration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    mockCheckAndDeduct.mockReset();
  });

  const input = {
    supabase: mockSupabase(),
    userId: 'user-1',
    generationId: 'gen-1',
    faceless: false,
    faceQuality: 'ok' as const,
  };

  it('passes through the cost when the token gate succeeds', async () => {
    mockCheckAndDeduct.mockResolvedValue({ ok: true, cost: 3 });
    const result = await gateGeneration(input);
    expect(result).toEqual({ ok: true, cost: 3 });
    expect(mockCheckAndDeduct).toHaveBeenCalledWith(
      input.supabase,
      'user-1',
      'gen-1',
      false,
      'ok',
    );
  });

  it('returns FREE_EXHAUSTED with the gate status when free tokens ran out', async () => {
    mockCheckAndDeduct.mockResolvedValue({
      ok: false,
      error: 'free tokens exhausted',
      statusCode: 402,
      freeExhausted: true,
    });
    const result = await gateGeneration(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(402);
      expect(await result.response.json()).toEqual({
        success: false,
        error: 'free tokens exhausted',
        code: 'FREE_EXHAUSTED',
      });
    }
  });

  it('returns INSUFFICIENT when tokens are insufficient for other reasons', async () => {
    mockCheckAndDeduct.mockResolvedValue({
      ok: false,
      error: 'not enough tokens',
      statusCode: 402,
      freeExhausted: false,
    });
    const result = await gateGeneration(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(await result.response.json()).toEqual({
        success: false,
        error: 'not enough tokens',
        code: 'INSUFFICIENT',
      });
    }
  });
});

describe('startEngineVideoTask — error branches', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    logError.mockClear();
  });

  it('fails fast with 500 when MONEYPRINT_API_URL is missing', async () => {
    vi.stubEnv('MONEYPRINT_API_SECRET', 'test-secret');
    vi.stubEnv('MONEYPRINT_API_URL', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await startEngineVideoTask('user-1', { prompt: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(500);
      expect(await result.response.json()).toEqual({
        success: false,
        error: 'MONEYPRINT_API_URL is not defined',
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 502 when the engine is unreachable', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'test-secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused');
      }),
    );
    const result = await startEngineVideoTask('user-1', { prompt: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(502);
      expect(await result.response.json()).toEqual({
        success: false,
        error: 'Video service is unavailable.',
      });
    }
    expect(logError).toHaveBeenCalled();
  });

  it('returns 502 with the upstream status and body when the engine rejects the job', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'test-secret');
    vi.stubGlobal('fetch', vi.fn(async () => engineResponse('{"detail":"bad prompt"}', 422)));
    const result = await startEngineVideoTask('user-1', { prompt: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(502);
      expect(await result.response.json()).toEqual({
        success: false,
        error: 'Video service rejected the job.',
      });
      expect(result.upstreamStatus).toBe(422);
      expect(result.upstreamBody).toEqual({ detail: 'bad prompt' });
    }
  });

  it('strips trailing slashes from the engine base URL', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://engine.test///');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'test-secret');
    const fetchMock = vi.fn(async () =>
      engineResponse(JSON.stringify({ body: { task_id: 't-1' } })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await startEngineVideoTask('user-1', { prompt: 'x' });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://engine.test/api/v1/videos',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-secret',
          'x-user-id': 'user-1',
        }),
      }),
    );
  });

  it('tolerates a non-JSON engine body', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'test-secret');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    const result = await startEngineVideoTask('user-1', { prompt: 'x' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.taskId).toBeUndefined();
      expect(result.body).toBeNull();
    }
  });

  it('rejects a non-string task id inside the envelope', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'test-secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => engineResponse(JSON.stringify({ body: { task_id: 42 } }))),
    );
    const result = await startEngineVideoTask('user-1', { prompt: 'x' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.taskId).toBeUndefined();
  });
});

describe('refundFailedGeneration', () => {
  afterEach(() => {
    mockRefund.mockReset();
  });

  it('delegates the refund to token-check', async () => {
    const supabase = mockSupabase();
    mockRefund.mockResolvedValue(true);
    await refundFailedGeneration(supabase, 'user-1', 'gen-1');
    expect(mockRefund).toHaveBeenCalledWith(supabase, 'user-1', 'gen-1');
  });
});

describe('attachGenerationTask', () => {
  afterEach(() => {
    logError.mockClear();
  });

  function mockChain(error: unknown) {
    const eq2 = vi.fn().mockResolvedValue({ error });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const update = vi.fn().mockReturnValue({ eq: eq1 });
    const from = vi.fn().mockReturnValue({ update });
    return { supabase: { from } as unknown as SupabaseClient, from, update, eq1, eq2 };
  }

  it('links the engine task to the generation charge row', async () => {
    const { supabase, from, update, eq1, eq2 } = mockChain(null);
    await attachGenerationTask(supabase, 'gen-1', 'task-1');
    expect(from).toHaveBeenCalledWith('token_transactions');
    expect(update).toHaveBeenCalledWith({ engine_task_id: 'task-1' });
    expect(eq1).toHaveBeenCalledWith('generation_id', 'gen-1');
    expect(eq2).toHaveBeenCalledWith('type', 'video_generation');
    expect(logError).not.toHaveBeenCalled();
  });

  it('logs loudly instead of throwing when the update fails', async () => {
    const { supabase } = mockChain(new Error('db down'));
    await expect(attachGenerationTask(supabase, 'gen-1', 'task-1')).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith(
      '[generation] failed to attach engine task',
      expect.any(Error),
      { generationId: 'gen-1', taskId: 'task-1' },
    );
  });
});

describe('uploadEngineTempAsset', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    logError.mockClear();
  });

  const file = new File(['bytes'], 'voice.mp3', { type: 'audio/mpeg' });

  it('returns undefined and logs when MONEYPRINT_API_URL is missing', async () => {
    vi.stubEnv('MONEYPRINT_API_SECRET', 'test-secret');
    vi.stubEnv('MONEYPRINT_API_URL', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(uploadEngineTempAsset('user-1', file, 'mp3')).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalled();
  });

  it('returns undefined when the engine is unreachable', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'test-secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down');
      }),
    );
    await expect(uploadEngineTempAsset('user-1', file, 'mp3')).resolves.toBeUndefined();
  });

  it('returns undefined when the engine rejects the upload', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'test-secret');
    vi.stubGlobal('fetch', vi.fn(async () => engineResponse('{"detail":"too big"}', 413)));
    await expect(uploadEngineTempAsset('user-1', file, 'mp3')).resolves.toBeUndefined();
  });

  it.each([
    ['null body', 'null'],
    ['string body', '"just a string"'],
    ['null data', '{"data":null}'],
    ['missing url', '{"data":{}}'],
    ['non-string url', '{"data":{"url":42}}'],
  ])('returns undefined for %s', async (_label, body) => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'test-secret');
    vi.stubGlobal('fetch', vi.fn(async () => engineResponse(body)));
    await expect(uploadEngineTempAsset('user-1', file, 'mp3')).resolves.toBeUndefined();
  });

  it('returns the engine URL and uploads the file with the derived name', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://engine.test///');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'test-secret');
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      engineResponse(JSON.stringify({ data: { url: 'https://engine.test/temp/a.mp3' } })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const url = await uploadEngineTempAsset('user-1', file, 'mp3');
    expect(url).toBe('https://engine.test/temp/a.mp3');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://engine.test/api/v1/temp_assets',
      expect.objectContaining({ method: 'POST' }),
    );
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init).toBeDefined();
    const formData = (init as RequestInit).body as FormData;
    const uploaded = formData.get('file') as File;
    expect(uploaded.name).toBe('asset.mp3');
  });
});
