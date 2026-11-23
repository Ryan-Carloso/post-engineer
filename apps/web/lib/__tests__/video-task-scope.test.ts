// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(() => 'log-id'), warn: vi.fn(() => 'log-id'), info: vi.fn(() => 'log-id') },
}));

import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/logger';
import {
  enforceScopedTaskRead,
  generationPersonaOrFilter,
  isTaskVisibleToScopedKey,
  resolveTaskScope,
  type TaskScope,
} from '../video-task-scope';

const USER_ID = 'user-1';
const PERSONA_A = '11111111-1111-4111-8111-111111111111';
const PERSONA_B = '22222222-2222-4222-8222-222222222222';
const TASK_ID = 'task-1';
const SCHEDULE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROUTE = 'GET /api/persona/video-status';

interface QueryResult {
  data: unknown;
  error: unknown;
}

const EMPTY: QueryResult = { data: null, error: null };

function client(tables: Record<string, QueryResult>): { supabase: SupabaseClient; queried: string[] } {
  const queried: string[] = [];
  const supabase = {
    from(table: string) {
      queried.push(table);
      const result = tables[table] ?? EMPTY;
      const chain = {
        select: () => chain,
        eq: () => chain,
        limit: () => chain,
        maybeSingle: async () => result,
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { supabase, queried };
}

describe('generationPersonaOrFilter', () => {
  it('keeps only persona-less rows when every id is not a UUID', () => {
    expect(generationPersonaOrFilter([])).toEqual({ kind: 'null' });
    expect(generationPersonaOrFilter(['not-a-uuid', '33333333-3333-4333-8333-333333333333),hack'])).toEqual({
      kind: 'null',
    });
  });

  it('builds an or-filter from the UUID ids and a null persona', () => {
    expect(generationPersonaOrFilter([PERSONA_A, 'not-a-uuid', PERSONA_B])).toEqual({
      kind: 'or',
      filter: `persona_id.in.(${PERSONA_A},${PERSONA_B}),persona_id.is.null`,
    });
  });
});

describe('resolveTaskScope', () => {
  it('uses the generation persona and does not look at the slot', async () => {
    const { supabase, queried } = client({
      video_generations: { data: { persona_id: PERSONA_A }, error: null },
      scheduled_posts: { data: { schedule_id: SCHEDULE_ID, voiceover: true }, error: null },
    });

    await expect(resolveTaskScope(supabase, USER_ID, TASK_ID)).resolves.toEqual({
      found: true,
      personaId: PERSONA_A,
      voiceover: false,
      scheduleMissing: false,
    });
    expect(queried).toEqual(['video_generations']);
  });

  it('treats a null generation persona as a voiceover post', async () => {
    const { supabase } = client({
      video_generations: { data: { persona_id: null }, error: null },
    });

    await expect(resolveTaskScope(supabase, USER_ID, TASK_ID)).resolves.toEqual({
      found: true,
      personaId: null,
      voiceover: true,
      scheduleMissing: false,
    });
  });

  it('treats a non-object generation row as a voiceover post', async () => {
    const { supabase } = client({
      video_generations: { data: ['not-a-row'], error: null },
    });

    await expect(resolveTaskScope(supabase, USER_ID, TASK_ID)).resolves.toEqual({
      found: true,
      personaId: null,
      voiceover: true,
      scheduleMissing: false,
    });
  });

  it('throws the generation lookup error', async () => {
    const dbError = { code: 'XX000', message: 'connection reset' };
    const { supabase } = client({ video_generations: { data: null, error: dbError } });

    await expect(resolveTaskScope(supabase, USER_ID, TASK_ID)).rejects.toBe(dbError);
  });

  it('returns not found when neither a generation nor a slot exists', async () => {
    const { supabase, queried } = client({});

    await expect(resolveTaskScope(supabase, USER_ID, TASK_ID)).resolves.toEqual({
      found: false,
      personaId: null,
      voiceover: false,
      scheduleMissing: false,
    });
    expect(queried).toEqual(['video_generations', 'scheduled_posts']);
  });

  it('throws the slot lookup error', async () => {
    const dbError = { code: 'XX000', message: 'slot down' };
    const { supabase } = client({ scheduled_posts: { data: null, error: dbError } });

    await expect(resolveTaskScope(supabase, USER_ID, TASK_ID)).rejects.toBe(dbError);
  });

  it('keeps a slot with no schedule id and reads voiceover only from literal true', async () => {
    const voiceover = client({
      scheduled_posts: { data: { schedule_id: null, voiceover: true }, error: null },
    });
    await expect(resolveTaskScope(voiceover.supabase, USER_ID, TASK_ID)).resolves.toEqual({
      found: true,
      personaId: null,
      voiceover: true,
      scheduleMissing: false,
    });

    const faced = client({
      scheduled_posts: { data: { schedule_id: null, voiceover: false }, error: null },
    });
    await expect(resolveTaskScope(faced.supabase, USER_ID, TASK_ID)).resolves.toMatchObject({
      found: true,
      personaId: null,
      voiceover: false,
      scheduleMissing: false,
    });

    const word = client({
      scheduled_posts: { data: { schedule_id: null, voiceover: 'true' }, error: null },
    });
    await expect(resolveTaskScope(word.supabase, USER_ID, TASK_ID)).resolves.toMatchObject({
      voiceover: false,
    });
  });

  it('reads the persona from the schedule row', async () => {
    const { supabase, queried } = client({
      scheduled_posts: { data: { schedule_id: SCHEDULE_ID, voiceover: false }, error: null },
      schedules: { data: { persona_id: PERSONA_B }, error: null },
    });

    await expect(resolveTaskScope(supabase, USER_ID, TASK_ID)).resolves.toEqual({
      found: true,
      personaId: PERSONA_B,
      voiceover: false,
      scheduleMissing: false,
    });
    expect(queried).toEqual(['video_generations', 'scheduled_posts', 'schedules']);
  });

  it('marks a deleted schedule without turning the post voiceover', async () => {
    const faced = client({
      scheduled_posts: { data: { schedule_id: SCHEDULE_ID, voiceover: false }, error: null },
      schedules: { data: null, error: null },
    });
    await expect(resolveTaskScope(faced.supabase, USER_ID, TASK_ID)).resolves.toEqual({
      found: true,
      personaId: null,
      voiceover: false,
      scheduleMissing: true,
    });

    const voiceover = client({
      scheduled_posts: { data: { schedule_id: SCHEDULE_ID, voiceover: true }, error: null },
      schedules: { data: null, error: null },
    });
    await expect(resolveTaskScope(voiceover.supabase, USER_ID, TASK_ID)).resolves.toMatchObject({
      voiceover: true,
      scheduleMissing: true,
    });
  });

  it('throws the schedule lookup error', async () => {
    const dbError = { code: 'XX000', message: 'schedule down' };
    const { supabase } = client({
      scheduled_posts: { data: { schedule_id: SCHEDULE_ID, voiceover: true }, error: null },
      schedules: { data: null, error: dbError },
    });

    await expect(resolveTaskScope(supabase, USER_ID, TASK_ID)).rejects.toBe(dbError);
  });
});

describe('isTaskVisibleToScopedKey', () => {
  const ids = [PERSONA_A];

  it('hides a task that was not found', () => {
    const scope: TaskScope = { found: false, personaId: null, voiceover: true, scheduleMissing: false };
    expect(isTaskVisibleToScopedKey(scope, ids)).toBe(false);
  });

  it('shows a deleted schedule only when the slot is voiceover', () => {
    const voiceover: TaskScope = { found: true, personaId: null, voiceover: true, scheduleMissing: true };
    const faced: TaskScope = { found: true, personaId: null, voiceover: false, scheduleMissing: true };
    expect(isTaskVisibleToScopedKey(voiceover, ids)).toBe(true);
    expect(isTaskVisibleToScopedKey(faced, ids)).toBe(false);
  });

  it('shows a null persona only when the post is voiceover', () => {
    const voiceover: TaskScope = { found: true, personaId: null, voiceover: true, scheduleMissing: false };
    const faced: TaskScope = { found: true, personaId: null, voiceover: false, scheduleMissing: false };
    expect(isTaskVisibleToScopedKey(voiceover, ids)).toBe(true);
    expect(isTaskVisibleToScopedKey(faced, ids)).toBe(false);
  });

  it('shows a persona only when the key lists it', () => {
    const allowed: TaskScope = { found: true, personaId: PERSONA_A, voiceover: false, scheduleMissing: false };
    const other: TaskScope = { found: true, personaId: PERSONA_B, voiceover: false, scheduleMissing: false };
    expect(isTaskVisibleToScopedKey(allowed, ids)).toBe(true);
    expect(isTaskVisibleToScopedKey(other, ids)).toBe(false);
  });
});

describe('enforceScopedTaskRead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips the lookup for an unscoped API key', async () => {
    const response = await enforceScopedTaskRead(
      { userId: USER_ID, isApiKey: true, personaIds: null },
      TASK_ID,
      ROUTE,
      'Video not found.',
    );

    expect(response).toBeNull();
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it('skips the lookup for an OAuth caller', async () => {
    const oauth = { userId: USER_ID, isApiKey: false, isOAuth: true, personaIds: [PERSONA_A] };
    const response = await enforceScopedTaskRead(
      oauth,
      TASK_ID,
      ROUTE,
      'Video not found.',
    );

    expect(response).toBeNull();
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it('allows a scoped key to read its own persona', async () => {
    const { supabase } = client({
      video_generations: { data: { persona_id: PERSONA_A }, error: null },
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(supabase);

    const response = await enforceScopedTaskRead(
      { userId: USER_ID, isApiKey: true, personaIds: [PERSONA_A] },
      TASK_ID,
      ROUTE,
      'Video not found.',
    );

    expect(response).toBeNull();
  });

  it('answers 404 when the task is outside the key scope', async () => {
    const { supabase } = client({
      video_generations: { data: { persona_id: PERSONA_B }, error: null },
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(supabase);

    const response = await enforceScopedTaskRead(
      { userId: USER_ID, isApiKey: true, personaIds: [PERSONA_A] },
      TASK_ID,
      ROUTE,
      'Video not found.',
    );

    expect(response?.status).toBe(404);
    await expect(response?.json()).resolves.toMatchObject({ success: false, error: 'Video not found.' });
  });

  it('logs the lookup error and answers 500', async () => {
    const dbError = { code: 'XX000', message: 'connection reset' };
    const { supabase } = client({ video_generations: { data: null, error: dbError } });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(supabase);

    const response = await enforceScopedTaskRead(
      { userId: USER_ID, isApiKey: true, personaIds: [PERSONA_A] },
      TASK_ID,
      ROUTE,
      'Video not found.',
    );

    expect(response?.status).toBe(500);
    await expect(response?.json()).resolves.toMatchObject({
      success: false,
      error: 'Failed to load video task.',
    });
    expect(logger.error).toHaveBeenCalledWith(
      '[video-task-scope] task scope lookup failed',
      dbError,
      { taskId: TASK_ID, route: ROUTE },
    );
  });
});
