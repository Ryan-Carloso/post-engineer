import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getGenerationPost } from '../generation-post-detail';

vi.mock('../engine-tasks', () => ({
  fetchEnginePublishResults: vi.fn(async () => ({})),
  fetchEngineTaskProgress: vi.fn(async () => ({
    gone: false,
    progress: 67,
    stage: 'audio',
    state: 4,
    scriptAngle: 'The myth that keeps coming back',
    warnings: [],
  })),
  fetchEngineScriptAngle: vi.fn(async () => 'The myth that keeps coming back'),
}));

vi.mock('../logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const PGRST116 = { code: 'PGRST116', message: 'zero rows' };

function chain(result: { data: unknown; error: unknown }) {
  const single = vi.fn(async () => result);
  const maybeSingle = vi.fn(async () => result);
  const order = vi.fn(async () => result);
  const eq = vi.fn(() => ({ single, maybeSingle, eq, order }));
  const select = vi.fn(() => ({ eq, order }));
  return { select, eq, single, maybeSingle, order };
}

function mockSupabase(tables: Record<string, { data: unknown; error: unknown }>) {
  const chains: Record<string, ReturnType<typeof chain>> = {};
  const from = vi.fn((table: string) => {
    if (!chains[table]) chains[table] = chain(tables[table] ?? { data: null, error: PGRST116 });
    return chains[table];
  });
  return { supabase: { from } as unknown as SupabaseClient, from };
}

const GENERATION_ROW = {
  id: 'vg-1',
  generation_id: 'gen-1:slot:slot-1',
  engine_task_id: 'task-1',
  persona_id: 'persona-1',
  persona_name: 'Viva Leve',
  video_subject: 'myth busting',
  status: 'pending',
  error_code: null,
  tokens_refunded: false,
  created_at: '2026-10-17T10:00:00.000Z',
  completed_at: null,
};

describe('getGenerationPost uncovered branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps progress at 0 when a live task is already gone', async () => {
    const { fetchEngineTaskProgress } = await import('../engine-tasks');
    vi.mocked(fetchEngineTaskProgress).mockResolvedValueOnce({
      gone: true,
      progress: 40,
      stage: 'audio',
      state: -1,
      scriptAngle: null,
      warnings: ['avatar_disabled'],
    });
    const { supabase } = mockSupabase({
      video_generations: { data: GENERATION_ROW, error: null },
    });
    const detail = await getGenerationPost(supabase, 'gen-1:slot:slot-1', 'user-1', null);
    expect(detail?.progress).toBe(0);
    expect(detail?.stage).toBeNull();
    expect(detail?.warnings).toEqual(['avatar_disabled']);
  });

  it('falls back to the script-angle read when a completed progress lookup throws', async () => {
    const { fetchEngineTaskProgress, fetchEngineScriptAngle } = await import('../engine-tasks');
    vi.mocked(fetchEngineTaskProgress).mockRejectedValueOnce(new Error('engine down'));
    vi.mocked(fetchEngineScriptAngle).mockResolvedValueOnce('Recovered angle');
    const { supabase } = mockSupabase({
      video_generations: { data: { ...GENERATION_ROW, status: 'completed' }, error: null },
    });
    const detail = await getGenerationPost(supabase, 'gen-1:slot:slot-1', 'user-1', null);
    expect(detail?.scriptAngle).toBe('Recovered angle');
    expect(fetchEngineScriptAngle).toHaveBeenCalledWith('task-1', 'user-1');
  });

  it('nulls the script angle when the fallback angle read throws', async () => {
    const { fetchEngineTaskProgress, fetchEngineScriptAngle } = await import('../engine-tasks');
    vi.mocked(fetchEngineTaskProgress).mockRejectedValueOnce(new Error('engine down'));
    vi.mocked(fetchEngineScriptAngle).mockRejectedValueOnce(new Error('angle down'));
    const { supabase } = mockSupabase({
      video_generations: { data: { ...GENERATION_ROW, status: 'completed' }, error: null },
    });
    const detail = await getGenerationPost(supabase, 'gen-1:slot:slot-1', 'user-1', null);
    expect(detail?.scriptAngle).toBeNull();
  });

  it('maps tokens_refunded true and a non-array warnings payload', async () => {
    const { fetchEngineTaskProgress } = await import('../engine-tasks');
    vi.mocked(fetchEngineTaskProgress).mockResolvedValueOnce({
      gone: false,
      progress: 10,
      stage: 'audio',
      state: 4,
      scriptAngle: 'The myth that keeps coming back',
      warnings: 'avatar_disabled' as unknown as string[],
    });
    const { supabase } = mockSupabase({
      video_generations: { data: { ...GENERATION_ROW, tokens_refunded: true }, error: null },
    });
    const detail = await getGenerationPost(supabase, 'gen-1:slot:slot-1', 'user-1', null);
    expect(detail?.tokensRefunded).toBe(true);
    expect(detail?.warnings).toEqual([]);
  });
});
