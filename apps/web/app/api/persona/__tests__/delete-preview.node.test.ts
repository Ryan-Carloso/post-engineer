import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));
vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({
  trackApiEvent: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return { ...actual, applyRateLimit: vi.fn().mockResolvedValue(null) };
});

import { GET } from '../delete-preview/route';
import { GetPersonaDeletePreviewResponseSchema } from '@/lib/contracts/personas';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
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
    { id: 'slot-1', schedule_id: 'sched-1', status: 'publishing', user_id: USER_ID },
    { id: 'slot-2', schedule_id: 'sched-1', status: 'published', user_id: USER_ID },
    { id: 'slot-3', schedule_id: 'sched-2', status: 'ready', user_id: USER_ID },
    { id: 'slot-4', schedule_id: 'sched-2', status: 'failed', user_id: USER_ID },
    { id: 'slot-x', schedule_id: 'sched-1', status: 'ready', user_id: 'user-uuid-2' },
  ],
};

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

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth(null);
});

afterEach(() => {
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
  it('returns counts for schedules and upcoming, published and failed slots', async () => {
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
    expect(GetPersonaDeletePreviewResponseSchema.safeParse(body).success).toBe(true);
    expect(body.counts).toMatchObject({
      schedules: 2,
      upcomingSlots: 2,
      publishedSlots: 1,
      failedSlots: 1,
    });
    expect(Object.keys(body.counts).sort()).toEqual(['failedSlots', 'publishedSlots', 'schedules', 'upcomingSlots']);
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
});
