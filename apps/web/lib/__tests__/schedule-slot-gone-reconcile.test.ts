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

//---------------
// mockTables — per-table query results for the service client. The chain
// supports the shapes the settle path uses: .select().eq()*.limit() →
// .maybeSingle() (single row) or an awaited { data, error } (lists).
//
// Table results carry { data, error }; set the VIDEO row for
// video_generations (the generation resolution), TASK for the durable
// engine_task_state row, and SLOTS for scheduled_posts reads.
//---------------
type TableStub = { data?: unknown; error?: unknown };

function tableNode(conf: TableStub | undefined) {
  const resolve = () =>
    Promise.resolve({ data: conf?.data ?? null, error: conf?.error ?? null });
  const node = {
    select: (_cols: string) => node,
    eq: () => node,
    limit: (_n: number) => node,
    maybeSingle: () => resolve(),
    then: (onFulfilled: never) => resolve().then(onFulfilled),
  };
  return node;
}

function mockTables(tables: Partial<Record<string, TableStub>>): void {
  serviceClient.from.mockImplementation((table: string) => tableNode(tables[table]));
}

// The generation the task belongs to (video_generations row) — a batch slot
// row names the slot's generation directly.
const RESOLVED_GENERATION = 'batch:11111111-2222-3333-4444-555555555555';

const GENERATING_SLOT = {
  status: 'generating',
  task_id: 'task-abc',
  schedule_id: 'sched-1',
  id: 'slot-1',
};

describe('enrichSlot — gone engine task', () => {
  it('presents a failed slot as completed and never retryable when the generation row was backfilled (M2)', async () => {
    // Pre-fix behavior: the failed-slot tail refilled retryable from the
    // slot's own error text, offering a retry for a video the backfill
    // already recorded completed.
    fetchMock.mockResolvedValue(engineResponse(200, { body: { progress: 100, state: -1, stage: 'render', error: 'anything' } }));
    mockTables({
      video_generations: { data: [{ status: 'completed' }] },
      scheduled_posts: { data: [] },
      engine_task_state: { data: { state: -1, data: {} } },
    });

    const result = await enrichSlot({ ...GENERATING_SLOT, status: 'failed' }, 'user-1');

    expect(result.status).toBe('completed');
    expect(result.retryable).toBe(false);
    expect(result.progress).toBe(100);
  });

  it('refuses to settle on a batch-charge resolution key (M4)', async () => {
    // The resolution fallback can land on the shared batch charge key
    // (batch:<schedule_id>): that key belongs to the whole batch — stamping
    // it from ONE slot's task verdict would rewrite every sibling's
    // billing/history. The slot stays untouched and unresolved.
    fetchMock.mockResolvedValue(engineResponse(404, { message: 'task not found' }));
    mockTables({
      video_generations: { data: null },
      scheduled_posts: { data: { schedule_id: 'sched-9' } },
      token_transactions: { data: { generation_id: 'batch:sched-9' } },
      engine_task_state: { data: null },
    });

    const result = await enrichSlot(GENERATING_SLOT, 'user-1');

    expect(selectVideoGeneration).not.toHaveBeenCalled();
    expect(result.status).toBe('failed');
    expect(result.retryable).toBe(false);
  });

  it('settles the generation row as failed when no durable proof contradicts the 404', async () => {
    fetchMock.mockResolvedValue(engineResponse(404, { message: 'task not found' }));
    mockTables({
      // Resolution hit, task row absent, no published slot.
      video_generations: { data: { generation_id: RESOLVED_GENERATION } },
      scheduled_posts: { data: [] },
    });

    const result = await enrichSlot(GENERATING_SLOT, 'user-1');

    expect(selectVideoGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: RESOLVED_GENERATION,
        status: 'failed',
        engineTaskId: 'task-abc',
        errorCode: 'engine_restart',
      }),
    );
    expect(result.status).toBe('failed');
    expect(result.progress).toBe(0);
    expect(result.retryable).not.toBeNull();
  });

  it('backfills completed when the durable task state says the render finished', async () => {
    fetchMock.mockResolvedValue(engineResponse(404, { message: 'task not found' }));
    mockTables({
      video_generations: { data: { generation_id: RESOLVED_GENERATION } },
      engine_task_state: {
        data: { state: 1, data: { videos: ['out/final-1.mp4'], error: null } },
      },
    });

    const result = await enrichSlot(GENERATING_SLOT, 'user-1');

    expect(selectVideoGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: RESOLVED_GENERATION,
        status: 'completed',
        engineTaskId: 'task-abc',
      }),
    );
    expect(selectVideoGeneration).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
    expect(result.status).toBe('completed');
    // A delivered video is not retryable: false, never null — the failed-slot
    // tail refills a null retryable, which would offer a retry on delivered
    // work (review MAJOR 2).
    expect(result.retryable).toBe(false);
  });

  it('backfills completed when a published slot proves delivery (i18n: engine 404 mid-publish window)', async () => {
    fetchMock.mockResolvedValue(engineResponse(404, { message: 'task not found' }));
    mockTables({
      video_generations: { data: { generation_id: RESOLVED_GENERATION } },
      engine_task_state: { data: null },
      scheduled_posts: { data: [{ id: 'slot-9' }] },
    });

    await enrichSlot(GENERATING_SLOT, 'user-1');

    expect(selectVideoGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' }),
    );
    expect(selectVideoGeneration).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('leaves the history row untouched when the durable lookup errors even if no slot is published', async () => {
    // Pre-fix: published === false after a durable READ error fell through
    // to recordGenerationUpdate(failed) — contradicting the video-status
    // 404 path (read error → no write, no refund).
    fetchMock.mockResolvedValue(engineResponse(404, { message: 'task not found' }));
    mockTables({
      video_generations: { data: { generation_id: RESOLVED_GENERATION } },
      engine_task_state: { error: { message: 'connection reset' } },
      scheduled_posts: { data: [] },
    });

    const result = await enrichSlot(GENERATING_SLOT, 'user-1');

    expect(selectVideoGeneration).not.toHaveBeenCalled();
    expect(result.status).toBe('failed');
  });

  it('leaves the history row untouched when the durable lookup fails (unresolved is NOT failed)', async () => {
    fetchMock.mockResolvedValue(engineResponse(404, { message: 'task not found' }));
    mockTables({
      video_generations: { data: { generation_id: RESOLVED_GENERATION } },
      engine_task_state: { error: { message: 'connection reset' } },
      scheduled_posts: { error: { message: 'connection reset' } },
    });

    const result = await enrichSlot(GENERATING_SLOT, 'user-1');

    expect(selectVideoGeneration).not.toHaveBeenCalled();
    // The slot still reports the terminal engine answer so polling stops,
    // but the written verdict stays unset: an unverifiable state must not
    // record a false permanent failure.
    expect(result.status).toBe('failed');
  });

  it('keeps retryability metadata on the failed slot', async () => {
    fetchMock.mockResolvedValue(engineResponse(404, { message: 'task not found' }));
    mockTables({
      video_generations: { data: { generation_id: RESOLVED_GENERATION } },
      scheduled_posts: { data: [] },
    });
    const result = await enrichSlot(
      { ...GENERATING_SLOT, error: 'engine_restart: task not found' },
      'user-1',
    );
    expect(result.status).toBe('failed');
    expect(result.retryable).not.toBeNull();
  });

  it('uses a prefetched task from options instead of fetching the record again', async () => {
    const result = await enrichSlot(GENERATING_SLOT, 'user-1', new Map(), {
      task: { progress: 33, stage: 'render', state: 4, gone: false, scriptAngle: 'Myth' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(selectVideoGeneration).not.toHaveBeenCalled();
    expect(result.progress).toBe(33);
    expect(result.stage).toBe('render');
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
    serviceClient.from.mockReturnValue(tableNode({}));
    const result = await enrichSlot(GENERATING_SLOT, 'user-1');
    // Unresolvable generation: the history write is skipped (nothing to name),
    // but the slot still reports the terminal engine answer — showing
    // `generating` for a task the engine dropped is exactly the lie this
    // fixes. No settlement write is attempted against an unknown generation.
    expect(result.status).toBe('failed');
    expect(selectVideoGeneration).not.toHaveBeenCalled();
  });
});
