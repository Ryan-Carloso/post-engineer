import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSlotPost } from '../post-detail';

vi.mock('../schedule-slot-presentation', async () => {
  const actual = await vi.importActual<typeof import('../schedule-slot-presentation')>(
    '../schedule-slot-presentation',
  );
  return actual;
});

vi.mock('../engine-tasks', () => ({
  fetchEnginePublishResults: vi.fn(async () => ({})),
  fetchEngineTaskProgress: vi.fn(async () => ({
    gone: false,
    progress: 100,
    stage: 'done',
    state: 1,
    scriptAngle: 'The myth that keeps coming back',
    warnings: ['avatar_disabled'],
  })),
  fetchEngineScriptAngle: vi.fn(async () => 'The myth that keeps coming back'),
  fetchEnginePostMetricsSource: vi.fn(async () => ({
    publishResults: [],
    scriptAngle: 'The myth that keeps coming back',
    warnings: ['avatar_disabled'],
  })),
}));

vi.mock('../publish-links', () => ({
  resolvePublishLinks: vi.fn(() => []),
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
  return { supabase: { from } as unknown as SupabaseClient };
}

describe('getSlotPost ready/publishing warnings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('surfaces avatar_disabled while the slot is ready', async () => {
    const { supabase } = mockSupabase({
      scheduled_posts: {
        data: {
          id: 'slot-1',
          schedule_id: 'sched-1',
          slot_at: '2026-10-18T10:00:00.000Z',
          status: 'ready',
          topic: 'myth busting',
          error: null,
          published_at: null,
          task_id: 'task-1',
          faceless: false,
        },
        error: null,
      },
      schedules: {
        data: {
          id: 'sched-1',
          persona_id: 'persona-1',
          providers: ['youtube'],
          youtube_account_ids: ['acct-1'],
          instagram_account_ids: [],
          linkedin_account_ids: [],
          bluesky_account_ids: [],
        },
        error: null,
      },
      personas: { data: { id: 'persona-1', name: 'Viva Leve' }, error: null },
      scheduled_post_progress_history: { data: [], error: null },
    });
    const detail = await getSlotPost(supabase, 'slot-1', 'user-1', null);
    expect(detail?.slot.warnings).toEqual(['avatar_disabled']);
    expect(detail?.slot.status).toBe('ready');
  });
});
