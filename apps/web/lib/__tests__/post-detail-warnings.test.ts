import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getGenerationPost, getSlotPost } from '../post-detail';

vi.mock('../schedule-slot-presentation', () => ({
  enrichSlot: vi.fn(async () => ({
    status: 'generating',
    progress: 42,
    stage: 'video',
    queuePosition: null,
    queueTotal: null,
    retryable: null,
  })),
}));

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
  fetchEnginePostMetricsSource: vi.fn(async () => ({
    publishResults: [{ provider: 'youtube' }],
    scriptAngle: 'The myth that keeps coming back',
    warnings: [],
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
  const supabase = { from } as unknown as SupabaseClient;
  return { supabase, from, chains };
}

const SLOT_ROW = {
  id: 'slot-1',
  schedule_id: 'sched-1',
  slot_at: '2026-10-18T10:00:00.000Z',
  status: 'generating',
  topic: 'myth busting',
  error: null,
  published_at: null,
  task_id: 'task-1',
  faceless: false,
};

const SCHEDULE_ROW = {
  id: 'sched-1',
  persona_id: 'persona-1',
  providers: ['youtube'],
  youtube_account_ids: ['acct-1'],
  instagram_account_ids: [],
  linkedin_account_ids: [],
  bluesky_account_ids: [],
  timezone: 'UTC',
  post_language: 'en',
  post_voice_id: 'voice-1',
  post_video_aspect: '16:9',
  post_video_layout: 'standard',
  post_niche: 'fitness',
  post_paragraph_number: 3,
  post_face_quality: 'high',
  publish_mode: 'scheduled',
};

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

describe('post-detail warnings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('carries engine warnings from the published-slot metrics read', async () => {
    const { fetchEnginePostMetricsSource } = await import('../engine-tasks');
    vi.mocked(fetchEnginePostMetricsSource).mockResolvedValueOnce({
      publishResults: [{ provider: 'youtube' }],
      scriptAngle: 'The myth that keeps coming back',
      warnings: ['avatar_disabled'],
    });
    const { supabase } = mockSupabase({
      scheduled_posts: { data: { ...SLOT_ROW, status: 'published' }, error: null },
      schedules: { data: SCHEDULE_ROW, error: null },
      scheduled_post_progress_history: { data: [], error: null },
    });
    const detail = await getSlotPost(supabase, 'slot-1', 'user-1', null);
    expect(detail?.slot.warnings).toEqual(['avatar_disabled']);
  });

  it('degrades published-slot warnings when the metrics read throws', async () => {
    const { fetchEnginePostMetricsSource } = await import('../engine-tasks');
    vi.mocked(fetchEnginePostMetricsSource).mockRejectedValueOnce(new Error('engine down'));
    const { supabase } = mockSupabase({
      scheduled_posts: { data: { ...SLOT_ROW, status: 'published' }, error: null },
      schedules: { data: SCHEDULE_ROW, error: null },
      scheduled_post_progress_history: { data: [], error: null },
    });
    const detail = await getSlotPost(supabase, 'slot-1', 'user-1', null);
    expect(detail?.slot.warnings).toEqual([]);
    expect(detail?.slot.publishLinks).toEqual([]);
    expect(detail?.slot.scriptAngle).toBeNull();
  });

  it('copies prefetched engine warnings onto a generating slot', async () => {
    const { fetchEngineTaskProgress } = await import('../engine-tasks');
    vi.mocked(fetchEngineTaskProgress).mockResolvedValueOnce({
      gone: false,
      progress: 67,
      stage: 'audio',
      state: 4,
      scriptAngle: 'The myth that keeps coming back',
      warnings: ['avatar_disabled'],
    });
    const { supabase } = mockSupabase({
      scheduled_posts: { data: SLOT_ROW, error: null },
      schedules: { data: SCHEDULE_ROW, error: null },
      scheduled_post_progress_history: { data: [], error: null },
    });
    const detail = await getSlotPost(supabase, 'slot-1', 'user-1', null);
    expect(detail?.slot.warnings).toEqual(['avatar_disabled']);
  });

  it('treats a missing warnings field on the engine task as an empty list', async () => {
    const { fetchEngineTaskProgress } = await import('../engine-tasks');
    vi.mocked(fetchEngineTaskProgress).mockResolvedValueOnce({
      gone: false,
      progress: 100,
      stage: 'done',
      state: 1,
      scriptAngle: 'The myth that keeps coming back',
      warnings: undefined as unknown as string[],
    });
    const { supabase } = mockSupabase({
      video_generations: { data: { ...GENERATION_ROW, status: 'completed' }, error: null },
    });
    const detail = await getGenerationPost(supabase, 'gen-1:slot:slot-1', 'user-1', null);
    expect(detail?.warnings).toEqual([]);
  });
});
