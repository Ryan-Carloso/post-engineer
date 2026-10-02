// @vitest-environment node
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

//---------------
// GET /api/persona/delete-preview tests (real contract).
// The external boundary (Supabase + engine) is mocked; everything else is
// real: auth, ownership, counting, download-URL building.
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
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  // Rate limiting is bypassed for payload-behavior tests; one dedicated
  // test below covers the 429 path.
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return { ...actual, applyRateLimit: vi.fn().mockResolvedValue(null) };
});

import { GET } from '../delete-preview/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { logger } from '@/lib/logger';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const USER_ID = 'user-uuid-1';
const PERSONA_ID = 'persona-uuid-1';

type TableData = Record<string, Array<Record<string, unknown>>>;

const BASE_TABLES: TableData = {
  personas: [{ id: PERSONA_ID, name: 'Ryan', user_id: USER_ID }],
  schedules: [
    { id: 'sched-1', persona_id: PERSONA_ID, user_id: USER_ID },
    { id: 'sched-2', persona_id: PERSONA_ID, user_id: USER_ID },
  ],
  scheduled_posts: [
    { id: 'slot-1', schedule_id: 'sched-1', status: 'pending', user_id: USER_ID },
    { id: 'slot-2', schedule_id: 'sched-1', status: 'published', user_id: USER_ID },
    { id: 'slot-3', schedule_id: 'sched-2', status: 'ready', user_id: USER_ID },
    // Cross-user slot on the same schedule id shape: must never be counted.
    { id: 'slot-x', schedule_id: 'sched-1', status: 'pending', user_id: 'user-uuid-2' },
  ],
  video_generations: [
    {
      id: 'gen-1',
      engine_task_id: 'task-aaa',
      video_subject: 'Topic one',
      status: 'completed',
      persona_id: PERSONA_ID,
      user_id: USER_ID,
    },
    {
      id: 'gen-2',
      engine_task_id: 'task-bbb',
      video_subject: 'Topic two',
      status: 'failed',
      persona_id: PERSONA_ID,
      user_id: USER_ID,
    },
  ],
  persona_images: [
    { id: 'img-1', persona_id: PERSONA_ID, user_id: USER_ID },
    { id: 'img-2', persona_id: PERSONA_ID, user_id: USER_ID },
    { id: 'img-3', persona_id: PERSONA_ID, user_id: USER_ID },
  ],
};

// Minimal thenable query builder: .select().eq()/.in() accumulate predicates
// against the in-memory rows, so tests assert real scoping (user_id +
// persona_id), not just call counts. `await` resolves { data, error } — or
// { data: null, count, error } for head+count selects. .order()/.limit()
// bound the list query like production.
function makeClient(
  tables: Record<string, Array<Record<string, unknown>>>,
  errorOn?: string,
) {
  const from = (table: string) => {
    const predicates: Array<(row: Record<string, unknown>) => boolean> = [];
    let headCount = false;
    let limit: number | null = null;
    const builder = {
      select: vi.fn((_cols: string, opts?: { head?: boolean; count?: string }) => {
        headCount = opts?.head === true && opts?.count === 'exact';
        return builder;
      }),
      eq: vi.fn((col: string, val: unknown) => {
        predicates.push((row) => row[col] === val);
        return builder;
      }),
      in: vi.fn((col: string, vals: unknown[]) => {
        predicates.push((row) => vals.includes(row[col]));
        return builder;
      }),
      order: vi.fn(() => builder),
      limit: vi.fn((n: number) => {
        limit = n;
        return builder;
      }),
      single: vi.fn(async () => {
        if (errorOn === table) return { data: null, error: { message: 'db down' } };
        const rows = (tables[table] ?? []).filter((r) => predicates.every((p) => p(r)));
        if (rows.length === 0) {
          return { data: null, error: { code: 'PGRST116', message: 'zero rows' } };
        }
        return { data: rows[0], error: null };
      }),
      then: (resolve: (v: unknown) => void) => {
        if (errorOn === table) {
          resolve({ data: null, error: { message: 'db down' } });
          return;
        }
        const rows = (tables[table] ?? []).filter((r) => predicates.every((p) => p(r)));
        if (headCount) {
          resolve({ data: null, count: rows.length, error: null });
          return;
        }
        resolve({
          data: limit === null ? rows : rows.slice(0, limit),
          error: null,
        });
      },
    };
    return builder;
  };

  return { from: vi.fn(from) };
}

function mockAuth(personaIds: string[] | null = null) {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, personaIds, accessToken: 'cookie-token' },
    error: null,
  } as never);
}

function mockEngine(downloadUri: string | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: downloadUri !== null,
      status: downloadUri !== null ? 200 : 404,
      json: async () =>
        downloadUri !== null ? { state: 1, result: { video: downloadUri } } : null,
    })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth(null);
  mockEngine('/api/v1/download/task-aaa/final.mp4');
  vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.internal:8080');
  vi.stubEnv('MONEYPRINT_API_SECRET', 'test-secret');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function getClient(
  tables: Record<string, Array<Record<string, unknown>>> = BASE_TABLES,
  errorOn?: string,
) {
  const client = makeClient(tables, errorOn);
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  return client;
}

describe('GET /api/persona/delete-preview', () => {
  it('returns counts for schedules, upcoming slots, videos and images', async () => {
    getClient();
    const res = await GET(
      new Request(`http://localhost/api/persona/delete-preview?personaId=${PERSONA_ID}`),
    );
    const body = (await res.json()) as {
      success: boolean;
      counts: Record<string, number>;
    };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // 2 schedules; upcoming = pending + ready (published is terminal)
    expect(body.counts).toMatchObject({
      schedules: 2,
      upcomingSlots: 2,
      generatedVideos: 2,
      personaImages: 3,
    });
  });

  it('lists completed videos with rewritten download URLs; failed videos get null', async () => {
    getClient();
    const res = await GET(
      new Request(`http://localhost/api/persona/delete-preview?personaId=${PERSONA_ID}`),
    );
    const body = (await res.json()) as {
      videos: Array<{ taskId: string; topic: string; status: string; downloadUrl: string | null }>;
    };
    expect(body.videos).toHaveLength(2);
    expect(body.videos[0]).toMatchObject({
      taskId: 'task-aaa',
      topic: 'Topic one',
      status: 'completed',
      downloadUrl: '/api/persona/video-download/task-aaa/final.mp4',
    });
    // Failed generations are listed but never get a download link.
    expect(body.videos[1].downloadUrl).toBeNull();
  });

  it('returns null downloadUrl when the engine lookup fails', async () => {
    getClient();
    mockEngine(null);
    const res = await GET(
      new Request(`http://localhost/api/persona/delete-preview?personaId=${PERSONA_ID}`),
    );
    const body = (await res.json()) as {
      videos: Array<{ downloadUrl: string | null }>;
    };
    expect(body.videos[0].downloadUrl).toBeNull();
  });

  it('returns 400 when personaId is missing', async () => {
    getClient();
    const res = await GET(new Request('http://localhost/api/persona/delete-preview'));
    expect(res.status).toBe(400);
  });

  it('returns 404 with PERSONA_NOT_FOUND for another user\u2019s persona', async () => {
    getClient({ ...BASE_TABLES, personas: [] });
    const res = await GET(
      new Request(`http://localhost/api/persona/delete-preview?personaId=${PERSONA_ID}`),
    );
    const body = (await res.json()) as { code: string };
    expect(res.status).toBe(404);
    expect(body.code).toBe('PERSONA_NOT_FOUND');
  });

  it('returns 403 with PERSONA_SCOPE_DENIED for an API key outside persona scope', async () => {
    getClient();
    mockAuth(['other-persona']);
    const res = await GET(
      new Request(`http://localhost/api/persona/delete-preview?personaId=${PERSONA_ID}`),
    );
    const body = (await res.json()) as { code: string };
    expect(res.status).toBe(403);
    expect(body.code).toBe('PERSONA_SCOPE_DENIED');
  });

  it('returns 500 with INTERNAL_ERROR when a count query fails', async () => {
    getClient(BASE_TABLES, 'schedules');
    const res = await GET(
      new Request(`http://localhost/api/persona/delete-preview?personaId=${PERSONA_ID}`),
    );
    const body = (await res.json()) as { code: string };
    expect(res.status).toBe(500);
    expect(body.code).toBe('INTERNAL_ERROR');
  });

  it('uses the service client for OAuth callers (no cookie session)', async () => {
    const client = getClient();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: USER_ID, personaIds: null, accessToken: 'oauth-token', isOAuth: true },
      error: null,
    } as never);
    const res = await GET(
      new Request(`http://localhost/api/persona/delete-preview?personaId=${PERSONA_ID}`),
    );
    expect(res.status).toBe(200);
    expect(createSupabaseServiceClient).toHaveBeenCalled();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('returns 429 when the rate limiter rejects the request', async () => {
    getClient();
    const limited = new Response(JSON.stringify({ success: false, errorType: 'RATE_LIMITED' }), {
      status: 429,
    });
    vi.mocked(applyRateLimit).mockResolvedValueOnce(limited as never);
    const res = await GET(
      new Request(`http://localhost/api/persona/delete-preview?personaId=${PERSONA_ID}`),
    );
    expect(res.status).toBe(429);
    expect(applyRateLimit).toHaveBeenCalledWith(expect.any(Request), RATE_LIMITS.deletePreview, USER_ID);
  });

  it('caps engine lookups at 20 videos but reports the full count', async () => {
    const generations = Array.from({ length: 25 }, (_, i) => ({
      id: `gen-${i}`,
      persona_id: PERSONA_ID,
      user_id: USER_ID,
      engine_task_id: `task-${i}`,
      video_subject: `Topic ${i}`,
      status: 'completed',
    }));
    getClient({ ...BASE_TABLES, video_generations: generations });
    let engineCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        engineCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ state: 1, result: { video: '/api/v1/download/x/final.mp4' } }),
        };
      }),
    );
    const res = await GET(
      new Request(`http://localhost/api/persona/delete-preview?personaId=${PERSONA_ID}`),
    );
    const body = (await res.json()) as {
      counts: { generatedVideos: number };
      videos: unknown[];
      videosTruncated: boolean;
    };
    expect(res.status).toBe(200);
    expect(body.counts.generatedVideos).toBe(25);
    expect(body.videos).toHaveLength(20);
    expect(body.videosTruncated).toBe(true);
    expect(engineCalls).toBe(20);
  });

  it('reports videosTruncated:false when nothing is cut', async () => {
    getClient();
    const res = await GET(
      new Request(`http://localhost/api/persona/delete-preview?personaId=${PERSONA_ID}`),
    );
    const body = (await res.json()) as { videosTruncated: boolean };
    expect(body.videosTruncated).toBe(false);
  });

  it('flags transient engine failures as incomplete and logs them', async () => {
    getClient();
    // Engine 500: transient — the video may still exist.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => null })),
    );
    const res = await GET(
      new Request(`http://localhost/api/persona/delete-preview?personaId=${PERSONA_ID}`),
    );
    const body = (await res.json()) as {
      videos: Array<{ downloadUrl: string | null }>;
      linksIncomplete: boolean;
    };
    expect(res.status).toBe(200);
    expect(body.videos[0]?.downloadUrl).toBeNull();
    expect(body.linksIncomplete).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      '[api/persona/delete-preview] engine task lookup failed',
      expect.objectContaining({ engineTaskId: 'task-aaa', status: 500, transient: true }),
    );
  });

  it('flags unparseable engine bodies as transient and logs them', async () => {
    getClient();
    // Engine 200 with a garbled body: almost certainly transient.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('unexpected token');
        },
      })),
    );
    const res = await GET(
      new Request(`http://localhost/api/persona/delete-preview?personaId=${PERSONA_ID}`),
    );
    const body = (await res.json()) as {
      videos: Array<{ downloadUrl: string | null }>;
      linksIncomplete: boolean;
    };
    expect(res.status).toBe(200);
    expect(body.videos[0]?.downloadUrl).toBeNull();
    expect(body.linksIncomplete).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      '[api/persona/delete-preview] engine task response unparseable',
      expect.objectContaining({ engineTaskId: 'task-aaa' }),
    );
  });

  it('does not flag 404 engine responses as incomplete', async () => {
    getClient();
    // Engine 404: task pruned — truly gone, not transient.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, json: async () => null })),
    );
    const res = await GET(
      new Request(`http://localhost/api/persona/delete-preview?personaId=${PERSONA_ID}`),
    );
    const body = (await res.json()) as {
      videos: Array<{ downloadUrl: string | null }>;
      linksIncomplete: boolean;
    };
    expect(res.status).toBe(200);
    expect(body.videos[0]?.downloadUrl).toBeNull();
    expect(body.linksIncomplete).toBe(false);
  });

  it('stops engine lookups once the aggregate time budget is spent', async () => {
    const generations = Array.from({ length: 5 }, (_, i) => ({
      id: `gen-${i}`,
      persona_id: PERSONA_ID,
      user_id: USER_ID,
      engine_task_id: `task-${i}`,
      video_subject: `Topic ${i}`,
      status: 'completed',
    }));
    getClient({ ...BASE_TABLES, video_generations: generations });
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let engineCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        engineCalls += 1;
        now += 10_000; // each lookup burns 10s; the budget is 15s
        return {
          ok: true,
          status: 200,
          json: async () => ({ state: 1, result: { video: '/api/v1/download/x/final.mp4' } }),
        };
      }),
    );
    const res = await GET(
      new Request(`http://localhost/api/persona/delete-preview?personaId=${PERSONA_ID}`),
    );
    const body = (await res.json()) as {
      videos: Array<{ downloadUrl: string | null }>;
      linksIncomplete: boolean;
    };
    expect(res.status).toBe(200);
    // Lookups 0 and 1 run (t=0s, t=10s < 15s); 2..4 are skipped past budget.
    expect(engineCalls).toBe(2);
    expect(body.videos).toHaveLength(5);
    expect(body.videos[0]?.downloadUrl).toContain('/api/persona/video-download/');
    expect(body.videos[1]?.downloadUrl).toContain('/api/persona/video-download/');
    expect(body.videos[2]?.downloadUrl).toBeNull();
    expect(body.videos[3]?.downloadUrl).toBeNull();
    expect(body.videos[4]?.downloadUrl).toBeNull();
    // The degradation is flagged so the UI does not call it "unavailable".
    expect(body.linksIncomplete).toBe(true);
  });
});
