// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enrichSlot } from '../schedule-slot-presentation';

const fetchMock = vi.fn();
const serviceClient = { from: vi.fn() };
const selectVideoGeneration = vi.fn();

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => serviceClient,
}));

vi.mock('@/lib/generation/video-generation', () => ({
  recordGenerationUpdate: (...args: unknown[]) => selectVideoGeneration(...args),
}));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test');
  vi.stubEnv('MONEYPRINT_API_SECRET', 'secret');
  fetchMock.mockReset();
  selectVideoGeneration.mockReset();
  serviceClient.from.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function engineResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// The resolution helper reads video_generations by task id first; a row
// there is the direct-generation case and needs no ledger lookup.
function mockResolution(row: unknown) {
  serviceClient.from.mockReturnValue({
    select: () => ({
      eq: () => ({
        eq: () => ({
          limit: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
        }),
      }),
    }),
  });
}

const GENERATING_SLOT = {
  status: 'generating',
  task_id: 'task-abc',
  schedule_id: 'sched-1',
  id: 'slot-1',
};

describe('enrichSlot — gone engine task', () => {
  it('settles the generation row as failed when the engine 404s', async () => {
    fetchMock.mockResolvedValue(engineResponse(404, { message: 'task not found' }));
    mockResolution({ generation_id: 'batch:11111111-2222-3333-4444-555555555555' });

    const result = await enrichSlot(GENERATING_SLOT, 'user-1');

    expect(selectVideoGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: 'batch:11111111-2222-3333-4444-555555555555',
        status: 'failed',
        engineTaskId: 'task-abc',
        errorCode: 'engine_restart',
      }),
    );
    expect(result.status).toBe('failed');
    expect(result.progress).toBe(0);
  });

  it('keeps retryability metadata on the failed slot', async () => {
    fetchMock.mockResolvedValue(engineResponse(404, { message: 'task not found' }));
    mockResolution({ generation_id: 'batch:11111111-2222-3333-4444-555555555555' });
    const result = await enrichSlot(
      { ...GENERATING_SLOT, error: 'engine_restart: task not found' },
      'user-1',
    );
    expect(result.status).toBe('failed');
    expect(result.retryable).not.toBeNull();
  });

  it('does not settle anything when the task is still alive', async () => {
    fetchMock.mockResolvedValue(engineResponse(200, { body: { progress: 50, state: 4, stage: 'render' } }));
    const result = await enrichSlot(GENERATING_SLOT, 'user-1');
    expect(selectVideoGeneration).not.toHaveBeenCalled();
    expect(result.status).toBe('generating');
    expect(result.progress).toBe(50);
    expect(result.stage).toBe('render');
  });

  it('does not settle anything on a transient engine error', async () => {
    fetchMock.mockResolvedValue(engineResponse(500, { error: 'boom' }));
    const result = await enrichSlot(GENERATING_SLOT, 'user-1');
    expect(selectVideoGeneration).not.toHaveBeenCalled();
    expect(result.status).toBe('generating');
    expect(result.progress).toBe(0);
  });

  it('does not settle anything when the generation cannot be resolved', async () => {
    fetchMock.mockResolvedValue(engineResponse(404, { message: 'task not found' }));
    serviceClient.from.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }),
    });
    const result = await enrichSlot(GENERATING_SLOT, 'user-1');
    // Unresolvable generation: the history write is skipped (nothing to name),
    // but the slot still reports the terminal engine answer — showing
    // `generating` for a task the engine dropped is exactly the lie this
    // fixes. No settlement write is attempted against an unknown generation.
    expect(result.status).toBe('failed');
    expect(selectVideoGeneration).not.toHaveBeenCalled();
  });
});