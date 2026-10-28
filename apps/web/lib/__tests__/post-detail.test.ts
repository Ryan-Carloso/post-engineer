import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getGenerationPost, getSlotPost, personaScopeOf } from '../post-detail';

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
  })),
  fetchEngineScriptAngle: vi.fn(async () => 'The myth that keeps coming back'),
  fetchEnginePostMetricsSource: vi.fn(async () => ({
    publishResults: [{ provider: 'youtube' }],
    scriptAngle: 'The myth that keeps coming back',
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
  title: 'myth busting',
  error: null,
  published_at: null,
  task_id: 'task-1',
  faceless: false, faceless_material: 'svg',
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

describe('getSlotPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the full slot detail for the owner', async () => {
    const { supabase, chains } = mockSupabase({
      scheduled_posts: { data: SLOT_ROW, error: null },
      schedules: { data: SCHEDULE_ROW, error: null },
      personas: { data: { id: 'persona-1', name: 'Viva Leve' }, error: null },
      scheduled_post_progress_history: { data: [], error: null },
    });
    const detail = await getSlotPost(supabase, 'slot-1', 'user-1', null);
    expect(detail?.slot.id).toBe('slot-1');
    // Pin the query shape: the select column list is load-bearing for the
    // camelCase mapping below.
    expect(chains['scheduled_posts'].select).toHaveBeenCalledWith(
      'id, schedule_id, slot_at, status, title, error, published_at, task_id, faceless, faceless_material'
    );
    expect(chains['schedules'].select).toHaveBeenCalledWith(
      'id, persona_id, providers, youtube_account_ids, instagram_account_ids, linkedin_account_ids, bluesky_account_ids, timezone, post_language, post_voice_id, post_video_aspect, post_video_layout, post_niche, post_paragraph_number, post_face_quality, publish_mode'
    );
    expect(detail?.slot.progress).toBe(42);
    expect(detail?.slot.stage).toBe('video');
    expect(detail?.schedule.publishMode).toBe('scheduled');
    expect(detail?.persona?.name).toBe('Viva Leve');
    expect(detail?.generation).toMatchObject({ faceless: false, material: 'svg' });
  });

  it('returns the script angle the engine recorded for the slot task', async () => {
    const { fetchEngineScriptAngle } = await import('../engine-tasks');
    const { supabase } = mockSupabase({
      scheduled_posts: { data: SLOT_ROW, error: null },
      schedules: { data: SCHEDULE_ROW, error: null },
      scheduled_post_progress_history: { data: [], error: null },
    });
    const detail = await getSlotPost(supabase, 'slot-1', 'user-1', null);
    // The generating slot's angle rides the progress read — no second lookup.
    expect(fetchEngineScriptAngle).not.toHaveBeenCalled();
    expect(detail?.slot.scriptAngle).toBe('The myth that keeps coming back');
  });

  it('reads publish results and the angle from one engine task read for a published slot', async () => {
    const { fetchEnginePostMetricsSource, fetchEnginePublishResults, fetchEngineScriptAngle } =
      await import('../engine-tasks');
    const { resolvePublishLinks } = await import('../publish-links');
    vi.mocked(resolvePublishLinks).mockReturnValueOnce([
      { provider: 'youtube', url: 'https://youtube.test/watch?v=1' },
    ]);
    const { supabase } = mockSupabase({
      scheduled_posts: { data: { ...SLOT_ROW, status: 'published' }, error: null },
      schedules: { data: SCHEDULE_ROW, error: null },
      scheduled_post_progress_history: { data: [], error: null },
    });
    const detail = await getSlotPost(supabase, 'slot-1', 'user-1', null);
    expect(fetchEnginePostMetricsSource).toHaveBeenCalledTimes(1);
    expect(fetchEnginePostMetricsSource).toHaveBeenCalledWith('task-1', 'user-1');
    expect(fetchEnginePublishResults).not.toHaveBeenCalled();
    expect(fetchEngineScriptAngle).not.toHaveBeenCalled();
    expect(resolvePublishLinks).toHaveBeenCalledWith([{ provider: 'youtube' }]);
    expect(detail?.slot.publishLinks).toEqual([
      { provider: 'youtube', url: 'https://youtube.test/watch?v=1' },
    ]);
    expect(detail?.slot.scriptAngle).toBe('The myth that keeps coming back');
  });

  it('reads a generating slot task once: progress carries the angle, no second lookup', async () => {
    const { fetchEngineTaskProgress, fetchEngineScriptAngle } = await import('../engine-tasks');
    const { enrichSlot } = await import('../schedule-slot-presentation');
    const { supabase } = mockSupabase({
      scheduled_posts: { data: SLOT_ROW, error: null },
      schedules: { data: SCHEDULE_ROW, error: null },
      scheduled_post_progress_history: { data: [], error: null },
    });
    const detail = await getSlotPost(supabase, 'slot-1', 'user-1', null);
    expect(fetchEngineTaskProgress).toHaveBeenCalledTimes(1);
    expect(fetchEngineScriptAngle).not.toHaveBeenCalled();
    // The prefetched progress is handed to enrichSlot so it does not fetch again.
    expect(vi.mocked(enrichSlot).mock.calls[0]?.[3]).toEqual({
      task: expect.objectContaining({ scriptAngle: 'The myth that keeps coming back' }),
    });
    expect(detail?.slot.scriptAngle).toBe('The myth that keeps coming back');
  });

  it('does not look up an angle for a slot that never dispatched', async () => {
    const { fetchEngineScriptAngle } = await import('../engine-tasks');
    const { supabase } = mockSupabase({
      scheduled_posts: { data: { ...SLOT_ROW, status: 'pending', task_id: null }, error: null },
      schedules: { data: SCHEDULE_ROW, error: null },
      scheduled_post_progress_history: { data: [], error: null },
    });
    const detail = await getSlotPost(supabase, 'slot-1', 'user-1', null);
    expect(fetchEngineScriptAngle).not.toHaveBeenCalled();
    expect(detail?.slot.scriptAngle).toBeNull();
  });

  it('degrades the slot angle to null and warns when the engine lookup throws', async () => {
    const { fetchEngineScriptAngle, fetchEngineTaskProgress } = await import('../engine-tasks');
    const { logger } = await import('../logger');
    // The one read of the task record fails: no second read is issued for
    // the angle — it degrades to null off the same failure.
    vi.mocked(fetchEngineTaskProgress).mockRejectedValueOnce(new Error('engine down'));
    const { supabase } = mockSupabase({
      scheduled_posts: { data: SLOT_ROW, error: null },
      schedules: { data: SCHEDULE_ROW, error: null },
      scheduled_post_progress_history: { data: [], error: null },
    });
    const detail = await getSlotPost(supabase, 'slot-1', 'user-1', null);
    expect(detail?.slot.scriptAngle).toBeNull();
    expect(fetchEngineScriptAngle).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('[post-detail] engine task progress unavailable', {
      taskId: 'task-1',
      error: 'engine down',
    });
  });

  it('returns null for an unknown id (PGRST116)', async () => {
    const { supabase } = mockSupabase({});
    await expect(getSlotPost(supabase, 'nope', 'user-1', null)).resolves.toBeNull();
  });

  it('returns null when the schedule row is gone', async () => {
    const { supabase } = mockSupabase({
      scheduled_posts: { data: SLOT_ROW, error: null },
      schedules: { data: null, error: null },
    });
    await expect(getSlotPost(supabase, 'slot-1', 'user-1', null)).resolves.toBeNull();
  });

  it('throws on DB errors so callers can 500', async () => {
    const { supabase } = mockSupabase({
      scheduled_posts: { data: null, error: new Error('db down') },
    });
    await expect(getSlotPost(supabase, 'slot-1', 'user-1', null)).rejects.toThrow('db down');
  });

  it('throws when the schedule lookup hits a DB error', async () => {
    const { supabase } = mockSupabase({
      scheduled_posts: { data: SLOT_ROW, error: null },
      schedules: { data: null, error: new Error('db down') },
    });
    await expect(getSlotPost(supabase, 'slot-1', 'user-1', null)).rejects.toThrow('db down');
  });

  it('degrades to a null persona when the persona lookup 404s', async () => {
    const { supabase } = mockSupabase({
      scheduled_posts: { data: SLOT_ROW, error: null },
      schedules: { data: SCHEDULE_ROW, error: null },
      personas: { data: null, error: PGRST116 },
      scheduled_post_progress_history: { data: [], error: null },
    });
    const detail = await getSlotPost(supabase, 'slot-1', 'user-1', null);
    expect(detail?.persona).toBeNull();
    expect(detail?.slot.id).toBe('slot-1');
  });

  it('degrades to an empty history list when the history lookup fails', async () => {
    const { supabase } = mockSupabase({
      scheduled_posts: { data: SLOT_ROW, error: null },
      schedules: { data: SCHEDULE_ROW, error: null },
      personas: { data: { id: 'persona-1', name: 'Viva Leve' }, error: null },
      scheduled_post_progress_history: { data: null, error: new Error('db down') },
    });
    const detail = await getSlotPost(supabase, 'slot-1', 'user-1', null);
    expect(detail?.slot.progressHistory).toEqual([]);
  });
});

describe('getGenerationPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns live engine progress for a pending generation that already has a task id', async () => {
    const { fetchEngineTaskProgress } = await import('../engine-tasks');
    const { supabase, chains } = mockSupabase({
      video_generations: { data: GENERATION_ROW, error: null },
    });
    const detail = await getGenerationPost(supabase, 'gen-1:slot:slot-1', 'user-1', null);
    expect(detail?.generationId).toBe('gen-1:slot:slot-1');
    expect(detail?.progress).toBe(67);
    expect(detail?.stage).toBe('audio');
    expect(detail?.tokensRefunded).toBe(false);
    expect(fetchEngineTaskProgress).toHaveBeenCalledWith('task-1', 'user-1');
    expect(chains['video_generations'].select).toHaveBeenCalledWith(
      'id, generation_id, engine_task_id, persona_id, persona_name, video_subject, status, error_code, tokens_refunded, created_at, completed_at'
    );
  });

  it('returns live engine progress once the generation is running', async () => {
    const { fetchEngineTaskProgress } = await import('../engine-tasks');
    const { supabase } = mockSupabase({
      video_generations: { data: { ...GENERATION_ROW, status: 'running' }, error: null },
    });
    const detail = await getGenerationPost(supabase, 'gen-1:slot:slot-1', 'user-1', null);
    expect(detail?.status).toBe('running');
    expect(detail?.progress).toBe(67);
    expect(detail?.stage).toBe('audio');
    expect(fetchEngineTaskProgress).toHaveBeenCalledWith('task-1', 'user-1');
  });

  it('takes the script angle from the progress read for a running generation (one engine read)', async () => {
    const { fetchEngineTaskProgress, fetchEngineScriptAngle } = await import('../engine-tasks');
    const { supabase } = mockSupabase({
      video_generations: { data: { ...GENERATION_ROW, status: 'running' }, error: null },
    });
    const detail = await getGenerationPost(supabase, 'gen-1:slot:slot-1', 'user-1', null);
    expect(fetchEngineTaskProgress).toHaveBeenCalledTimes(1);
    expect(fetchEngineScriptAngle).not.toHaveBeenCalled();
    expect(detail?.scriptAngle).toBe('The myth that keeps coming back');
  });

  it('does not call the engine for a pending generation with no task id', async () => {
    const { fetchEngineTaskProgress } = await import('../engine-tasks');
    const { supabase } = mockSupabase({
      video_generations: { data: { ...GENERATION_ROW, engine_task_id: null }, error: null },
    });
    const detail = await getGenerationPost(supabase, 'gen-1:slot:slot-1', 'user-1', null);
    expect(detail?.progress).toBe(0);
    expect(detail?.stage).toBeNull();
    expect(fetchEngineTaskProgress).not.toHaveBeenCalled();
  });

  it('does not call the engine for a running generation with no task id', async () => {
    const { fetchEngineTaskProgress } = await import('../engine-tasks');
    const { supabase } = mockSupabase({
      video_generations: {
        data: { ...GENERATION_ROW, status: 'running', engine_task_id: null },
        error: null,
      },
    });
    const detail = await getGenerationPost(supabase, 'gen-1:slot:slot-1', 'user-1', null);
    expect(detail?.progress).toBe(0);
    expect(fetchEngineTaskProgress).not.toHaveBeenCalled();
  });

  it('returns progress 0 for terminal generations (no progress lookup)', async () => {
    const { supabase, from } = mockSupabase({
      video_generations: { data: { ...GENERATION_ROW, status: 'completed' }, error: null },
    });
    const detail = await getGenerationPost(supabase, 'gen-1:slot:slot-1', 'user-1', null);
    expect(detail?.progress).toBe(0);
    expect(detail?.stage).toBeNull();
    expect(from).toHaveBeenCalledWith('video_generations');
  });

  it('degrades to 0/null when the engine progress lookup throws', async () => {
    const { fetchEngineTaskProgress, fetchEngineScriptAngle } = await import('../engine-tasks');
    vi.mocked(fetchEngineTaskProgress).mockRejectedValueOnce(new Error('engine down'));
    const { supabase } = mockSupabase({
      video_generations: { data: GENERATION_ROW, error: null },
    });
    const detail = await getGenerationPost(supabase, 'gen-1:slot:slot-1', 'user-1', null);
    expect(detail?.progress).toBe(0);
    expect(detail?.stage).toBeNull();
    // The failed progress read was the view's one task-record read: the
    // angle degrades to null instead of issuing a second read.
    expect(fetchEngineScriptAngle).not.toHaveBeenCalled();
    expect(detail?.scriptAngle).toBeNull();
  });

  it('returns the script angle for a completed generation', async () => {
    const { fetchEngineScriptAngle, fetchEngineTaskProgress } = await import('../engine-tasks');
    const { supabase } = mockSupabase({
      video_generations: { data: { ...GENERATION_ROW, status: 'completed' }, error: null },
    });
    const detail = await getGenerationPost(supabase, 'gen-1:slot:slot-1', 'user-1', null);
    expect(fetchEngineTaskProgress).not.toHaveBeenCalled();
    expect(fetchEngineScriptAngle).toHaveBeenCalledWith('task-1', 'user-1');
    expect(detail?.scriptAngle).toBe('The myth that keeps coming back');
  });

  it('returns a null angle for a generation with no task id', async () => {
    const { fetchEngineScriptAngle } = await import('../engine-tasks');
    const { supabase } = mockSupabase({
      video_generations: { data: { ...GENERATION_ROW, engine_task_id: null }, error: null },
    });
    const detail = await getGenerationPost(supabase, 'gen-1:slot:slot-1', 'user-1', null);
    expect(fetchEngineScriptAngle).not.toHaveBeenCalled();
    expect(detail?.scriptAngle).toBeNull();
  });

  it('returns null for an unknown id (PGRST116)', async () => {
    const { supabase } = mockSupabase({});
    await expect(getGenerationPost(supabase, 'nope', 'user-1', null)).resolves.toBeNull();
  });

  it('throws on DB errors so callers can 500', async () => {
    const { supabase } = mockSupabase({
      video_generations: { data: null, error: new Error('db down') },
    });
    await expect(getGenerationPost(supabase, 'gen-1', 'user-1', null)).rejects.toThrow('db down');
  });
});

describe('persona scope (persona-scoped API keys)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('personaScopeOf is null for a session, OAuth or unscoped key and the list for a scoped key', () => {
    expect(personaScopeOf({ isApiKey: false })).toBeNull();
    expect(personaScopeOf({ isApiKey: true, personaIds: null })).toBeNull();
    expect(personaScopeOf({ isApiKey: true, personaIds: ['persona-1'] })).toEqual(['persona-1']);
    expect(personaScopeOf({ isApiKey: true, personaIds: [] })).toEqual([]);
  });

  it('returns an in-scope slot', async () => {
    const { supabase } = mockSupabase({
      scheduled_posts: { data: SLOT_ROW, error: null },
      schedules: { data: SCHEDULE_ROW, error: null },
      personas: { data: { id: 'persona-1', name: 'Viva Leve' }, error: null },
      scheduled_post_progress_history: { data: [], error: null },
    });
    const detail = await getSlotPost(supabase, 'slot-1', 'user-1', ['persona-1']);
    expect(detail?.slot.id).toBe('slot-1');
  });

  it('returns null for a slot of another persona, before any engine call', async () => {
    const { enrichSlot } = await import('../schedule-slot-presentation');
    const { fetchEnginePublishResults } = await import('../engine-tasks');
    const { supabase, from } = mockSupabase({
      scheduled_posts: { data: SLOT_ROW, error: null },
      schedules: { data: SCHEDULE_ROW, error: null },
    });
    await expect(getSlotPost(supabase, 'slot-1', 'user-1', ['persona-2'])).resolves.toBeNull();
    expect(from).toHaveBeenCalledWith('schedules');
    expect(from).not.toHaveBeenCalledWith('personas');
    expect(enrichSlot).not.toHaveBeenCalled();
    expect(fetchEnginePublishResults).not.toHaveBeenCalled();
  });

  it('returns a persona-less slot to a scoped key', async () => {
    const { supabase } = mockSupabase({
      scheduled_posts: { data: SLOT_ROW, error: null },
      schedules: { data: { ...SCHEDULE_ROW, persona_id: null }, error: null },
      scheduled_post_progress_history: { data: [], error: null },
    });
    const detail = await getSlotPost(supabase, 'slot-1', 'user-1', []);
    expect(detail?.slot.id).toBe('slot-1');
    expect(detail?.persona).toBeNull();
  });

  it('returns an in-scope generation', async () => {
    const { supabase } = mockSupabase({ video_generations: { data: GENERATION_ROW, error: null } });
    const detail = await getGenerationPost(supabase, 'gen-1:slot:slot-1', 'user-1', ['persona-1']);
    expect(detail?.generationId).toBe('gen-1:slot:slot-1');
  });

  it('returns null for a generation of another persona, before any engine call', async () => {
    const { fetchEngineTaskProgress } = await import('../engine-tasks');
    const { supabase } = mockSupabase({ video_generations: { data: GENERATION_ROW, error: null } });
    await expect(
      getGenerationPost(supabase, 'gen-1:slot:slot-1', 'user-1', ['persona-2']),
    ).resolves.toBeNull();
    expect(fetchEngineTaskProgress).not.toHaveBeenCalled();
  });

  it('returns a persona-less generation to a scoped key', async () => {
    const { supabase } = mockSupabase({
      video_generations: { data: { ...GENERATION_ROW, persona_id: null }, error: null },
    });
    const detail = await getGenerationPost(supabase, 'gen-1:slot:slot-1', 'user-1', []);
    expect(detail?.generationId).toBe('gen-1:slot:slot-1');
  });
});
