// @vitest-environment node
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

//---------------
// DELETE /api/persona cascade tests (real contract).
// Supabase + engine are mocked; everything else is real: auth, ownership,
// delete ordering (slots -> schedules -> generations -> persona), counts,
// PostHog event, and the no-refund invariant.
//---------------

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));
vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
  engineAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer test', 'x-user-id': 'u' })),
}));
vi.mock('@/lib/analytics', () => ({
  trackApiEvent: vi.fn(),
}));
vi.mock('next/server', async (importOriginal) => {
  // after() needs a request scope; in tests the callback runs inline so
  // the post-response engine cleanup is still exercised.
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: (callback: () => unknown) => {
      void Promise.resolve().then(() => callback());
    },
  };
});

import { DELETE } from '../route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { trackApiEvent } from '@/lib/analytics';

const USER_ID = 'user-uuid-1';
const OTHER_USER = 'user-uuid-2';
const PERSONA_ID = 'persona-uuid-1';
const OTHER_PERSONA = 'persona-uuid-2';

type Row = Record<string, unknown>;

function baseTables(): Record<string, Row[]> {
  return {
    personas: [
      { id: PERSONA_ID, name: 'Ryan', user_id: USER_ID, photo_path: null, voice_audio_path: null },
      { id: OTHER_PERSONA, name: 'Other', user_id: OTHER_USER, photo_path: null, voice_audio_path: null },
    ],
    schedules: [
      { id: 'sched-1', persona_id: PERSONA_ID, user_id: USER_ID },
      { id: 'sched-2', persona_id: PERSONA_ID, user_id: USER_ID },
      { id: 'sched-9', persona_id: OTHER_PERSONA, user_id: OTHER_USER },
    ],
    scheduled_posts: [
      { id: 'slot-1', schedule_id: 'sched-1' },
      { id: 'slot-2', schedule_id: 'sched-1' },
      { id: 'slot-3', schedule_id: 'sched-2' },
      { id: 'slot-9', schedule_id: 'sched-9' },
    ],
    video_generations: [
      { id: 'gen-1', persona_id: PERSONA_ID, user_id: USER_ID, engine_task_id: 'task-aaa' },
      { id: 'gen-2', persona_id: PERSONA_ID, user_id: USER_ID, engine_task_id: null },
      { id: 'gen-9', persona_id: OTHER_PERSONA, user_id: OTHER_USER, engine_task_id: 'task-zzz' },
    ],
    persona_images: [
      { id: 'img-1', persona_id: PERSONA_ID, image_path: 'uid/img1.png' },
      { id: 'img-9', persona_id: OTHER_PERSONA, image_path: 'uid/img9.png' },
    ],
  };
}

// Thenable query builder with real in-memory filtering and real deletes,
// recording delete order per table.
function makeClient(tables: Record<string, Row[]>, deleteErrorOn?: string) {
  const deletes: string[] = [];
  const from = (table: string) => {
    const predicates: Array<(row: Row) => boolean> = [];
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((col: string, val: unknown) => {
        predicates.push((row) => row[col] === val);
        return builder;
      }),
      in: vi.fn((col: string, vals: unknown[]) => {
        predicates.push((row) => vals.includes(row[col]));
        return builder;
      }),
      single: vi.fn(async () => {
        const rows = (tables[table] ?? []).filter((r) => predicates.every((p) => p(r)));
        if (rows.length === 0) {
          return { data: null, error: { code: 'PGRST116', message: 'zero rows' } };
        }
        return { data: rows[0], error: null };
      }),
      delete: vi.fn(() => {
        deletes.push(table);
        const delPredicates: Array<(row: Row) => boolean> = [];
        const delBuilder = {
          eq: vi.fn((col: string, val: unknown) => {
            delPredicates.push((row) => row[col] === val);
            return delBuilder;
          }),
          in: vi.fn((col: string, vals: unknown[]) => {
            delPredicates.push((row) => vals.includes(row[col]));
            return delBuilder;
          }),
          then: (resolve: (v: unknown) => void) => {
            if (deleteErrorOn === table) {
              resolve({ error: { message: 'boom' }, count: null });
              return;
            }
            const doomed = (tables[table] ?? []).filter((row) =>
              delPredicates.every((p) => p(row)),
            );
            tables[table] = (tables[table] ?? []).filter(
              (row) => !delPredicates.every((p) => p(row)),
            );
            resolve({ error: null, count: doomed.length });
          },
        };
        return delBuilder;
      }),
      then: (resolve: (v: unknown) => void) => {
        resolve({
          data: (tables[table] ?? []).filter((r) => predicates.every((p) => p(r))),
          error: null,
        });
      },
    };
    return builder;
  };

  const removed: string[][] = [];
  const client = {
    from: vi.fn(from),
    storage: {
      from: vi.fn(() => ({
        remove: vi.fn(async (paths: string[]) => {
          removed.push(paths);
          return { error: null };
        }),
      })),
    },
  };
  return { client, deletes, removed };
}

function setup(tables?: Record<string, Row[]>, deleteErrorOn?: string, personaIds: string[] | null = null) {
  const t = tables ?? baseTables();
  const { client, deletes, removed } = makeClient(t, deleteErrorOn);
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, personaIds, accessToken: 'cookie-token' },
    error: null,
  } as never);
  return { tables: t, deletes, removed, client };
}

const engineDeletes: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  engineDeletes.length = 0;
  vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.internal:8080');
  vi.stubEnv('MONEYPRINT_API_SECRET', 'test-secret');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string }) => {
      if (init?.method === 'DELETE') engineDeletes.push(url);
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const del = (personaId: string) =>
  DELETE(new Request(`http://localhost/api/persona?personaId=${personaId}`, { method: 'DELETE' }));

// after() callbacks run on the microtask queue in tests; flush them before
// asserting on post-response side effects like the engine cleanup.
const flushAfterCallbacks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('DELETE /api/persona cascade', () => {
  it('deletes slots, schedules, generations and the persona — in that order', async () => {
    const { deletes } = setup();
    const res = await del(PERSONA_ID);
    const body = (await res.json()) as { success: boolean; deleted: Record<string, number> };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(deletes).toEqual(['scheduled_posts', 'schedules', 'video_generations', 'personas']);
    expect(body.deleted).toMatchObject({ schedules: 2, slots: 3, videos: 2 });
  });

  it('leaves no orphan rows behind', async () => {
    const { tables } = setup();
    await del(PERSONA_ID);

    expect(tables.personas.some((r) => r.id === PERSONA_ID)).toBe(false);
    expect(tables.schedules.some((r) => r.persona_id === PERSONA_ID)).toBe(false);
    expect(tables.scheduled_posts.some((r) => ['slot-1', 'slot-2', 'slot-3'].includes(r.id as string))).toBe(false);
    expect(tables.video_generations.some((r) => r.persona_id === PERSONA_ID)).toBe(false);
  });

  it('leaves another user\u2019s data untouched', async () => {
    const { tables } = setup();
    await del(PERSONA_ID);

    expect(tables.personas.some((r) => r.id === OTHER_PERSONA)).toBe(true);
    expect(tables.schedules.some((r) => r.id === 'sched-9')).toBe(true);
    expect(tables.scheduled_posts.some((r) => r.id === 'slot-9')).toBe(true);
    expect(tables.video_generations.some((r) => r.id === 'gen-9')).toBe(true);
  });

  it('never touches the token ledger', async () => {
    const { client } = setup();
    await del(PERSONA_ID);
    const touchedTables = vi.mocked(client.from).mock.calls.map((c) => c[0]);
    expect(touchedTables).not.toContain('token_transactions');
    expect(touchedTables).not.toContain('user_profiles');
  });

  it('emits persona_deleted with counts and no sensitive data', async () => {
    setup();
    await del(PERSONA_ID);
    expect(trackApiEvent).toHaveBeenCalledWith(
      'persona_deleted',
      expect.objectContaining({
        userId: USER_ID,
        personaId: PERSONA_ID,
        schedulesDeleted: 2,
        slotsDeleted: 3,
        videosDeleted: 2,
      }),
    );
    const props = vi.mocked(trackApiEvent).mock.calls[0][1] as Record<string, unknown>;
    expect(JSON.stringify(props)).not.toContain('task-aaa');
  });

  it('best-effort deletes engine task dirs for the persona\u2019s tasks', async () => {
    setup();
    await del(PERSONA_ID);
    await flushAfterCallbacks();
    expect(engineDeletes).toContain('https://engine.internal:8080/api/v1/tasks/task-aaa');
    expect(engineDeletes).not.toContain(
      expect.stringContaining('task-zzz'),
    );
  });

  it('skips unsafe engine task ids instead of interpolating them', async () => {
    const tables = baseTables();
    tables.video_generations.push({
      id: 'gen-evil',
      persona_id: PERSONA_ID,
      user_id: USER_ID,
      engine_task_id: '../../etc/passwd',
    });
    setup(tables);
    await del(PERSONA_ID);
    await flushAfterCallbacks();
    expect(engineDeletes).toContain('https://engine.internal:8080/api/v1/tasks/task-aaa');
    expect(engineDeletes).not.toContain(expect.stringContaining('etc'));
    expect(engineDeletes).not.toContain(expect.stringContaining('..'));
  });

  it('uses the service client for OAuth callers (no cookie session)', async () => {
    const { client } = setup();
    const { createSupabaseServiceClient } = await import('@/lib/supabase/service');
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: USER_ID, personaIds: null, accessToken: 'oauth-token', isOAuth: true },
      error: null,
    } as never);
    const res = await del(PERSONA_ID);
    expect(res.status).toBe(200);
    expect(createSupabaseServiceClient).toHaveBeenCalled();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('returns 404 PERSONA_NOT_FOUND for another user\u2019s persona and deletes nothing', async () => {
    const { deletes, tables } = setup();
    const res = await DELETE(
      new Request(`http://localhost/api/persona?personaId=${OTHER_PERSONA}`, { method: 'DELETE' }),
    );
    const body = (await res.json()) as { code: string };
    expect(res.status).toBe(404);
    expect(body.code).toBe('PERSONA_NOT_FOUND');
    expect(deletes).toEqual([]);
    expect(tables.personas).toHaveLength(2);
  });

  it('returns 403 PERSONA_SCOPE_DENIED for an API key outside persona scope', async () => {
    const { deletes } = setup(baseTables(), undefined, ['other-persona']);
    const res = await del(PERSONA_ID);
    const body = (await res.json()) as { code: string };
    expect(res.status).toBe(403);
    expect(body.code).toBe('PERSONA_SCOPE_DENIED');
    expect(deletes).toEqual([]);
  });

  it('returns 500 INTERNAL_ERROR when a cascade step fails, naming the step', async () => {
    const { deletes } = setup(baseTables(), 'schedules');
    const res = await del(PERSONA_ID);
    const body = (await res.json()) as { success: boolean; code: string };
    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.code).toBe('INTERNAL_ERROR');
    // Slots were deleted, schedules failed: the persona row must survive
    // (loud failure, never a silent half-delete).
    expect(deletes).toEqual(['scheduled_posts', 'schedules']);
  });
});
