// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enrichSlot } from '../schedule-slot-presentation';

const fetchMock = vi.fn();

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => ({ from: vi.fn() }),
}));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test');
  vi.stubEnv('MONEYPRINT_API_SECRET', 'secret');
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('enrichSlot — ready/publishing warnings', () => {
  it('surfaces avatar_disabled on a ready slot from the engine task', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        body: {
          progress: 100,
          state: 1,
          stage: 'done',
          user_warning_codes: ['avatar_disabled'],
        },
      }),
    });
    const result = await enrichSlot(
      { status: 'ready', task_id: 'task-ready', schedule_id: 'sched-1', id: 'slot-1' },
      'user-1',
    );
    expect(result.status).toBe('ready');
    expect(result.progress).toBe(100);
    expect(result.warnings).toEqual(['avatar_disabled']);
  });

  it('uses a prefetched task for publishing slots without a second fetch', async () => {
    const result = await enrichSlot(
      { status: 'publishing', task_id: 'task-pub', schedule_id: 'sched-1', id: 'slot-1' },
      'user-1',
      new Map(),
      {
        task: {
          progress: 100,
          stage: 'done',
          state: 1,
          gone: false,
          scriptAngle: null,
          warnings: ['avatar_disabled'],
        },
      },
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.warnings).toEqual(['avatar_disabled']);
  });

  it('copies prefetched warnings when engine lookup is disabled', async () => {
    const result = await enrichSlot(
      { status: 'ready', task_id: 'task-ready', schedule_id: 'sched-1', id: 'slot-1' },
      'user-1',
      new Map(),
      {
        allowEngineLookup: false,
        task: {
          progress: 100,
          stage: 'done',
          state: 1,
          gone: false,
          scriptAngle: null,
          warnings: ['avatar_disabled'],
        },
      },
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.warnings).toEqual(['avatar_disabled']);
  });

  it('keeps empty warnings when the ready-slot engine read throws', async () => {
    fetchMock.mockRejectedValue(new Error('engine down'));
    const result = await enrichSlot(
      { status: 'ready', task_id: 'task-ready', schedule_id: 'sched-1', id: 'slot-1' },
      'user-1',
    );
    expect(result.warnings).toEqual([]);
    expect(result.progress).toBe(100);
  });
});
