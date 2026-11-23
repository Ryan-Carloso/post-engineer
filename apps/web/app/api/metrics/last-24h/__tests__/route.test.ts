import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));
vi.mock('@/lib/request-auth', () => ({ requireSupabaseSession: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_LIMITS: { metrics: { name: 'metrics', limit: 60, windowMs: 60_000 } },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { GET } from '../route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { applyRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { METRICS_NONE } from '@/lib/metrics/metrics-query';
import { Last24hResponseSchema } from '@/lib/contracts/metrics';

const PERSONA = '11111111-2222-4333-8444-555555555555';
const OTHER_PERSONA = '99999999-2222-4333-8444-555555555555';
const HOUR = 60 * 60 * 1000;
const YT_OUTCOME = { provider: 'youtube', accountId: 'yt', status: 'published', videoUrl: 'https://www.youtube.com/shorts/abc123' };

type Result = { data: unknown; error: unknown };
type Call = [string, ...unknown[]];

function mockTables(tables: Record<string, Result>): { invocations: Array<{ table: string; calls: Call[] }> } {
  const invocations: Array<{ table: string; calls: Call[] }> = [];
  const from = vi.fn((table: string) => {
    const calls: Call[] = [];
    invocations.push({ table, calls });
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'gte', 'order']) {
      builder[method] = vi.fn((...args: unknown[]) => { calls.push([method, ...args]); return builder; });
    }
    builder.limit = vi.fn(async (...args: unknown[]) => {
      calls.push(['limit', ...args]);
      return tables[table] ?? { data: [], error: null };
    });
    return builder;
  });
  vi.mocked(createSupabaseServiceClient).mockReturnValue({ from } as never);
  return { invocations };
}

function dailyRows(postId: string, hoursAgoLatest = 1): Array<Record<string, unknown>> {
  const at = (hours: number): string => new Date(Date.now() - hours * HOUR).toISOString();
  return [
    { post_id: postId, provider: 'youtube', external_id: 'abc123', collected_at: at(hoursAgoLatest), views: 1000, likes: 10, comments: 2, saves: 0 },
    { post_id: postId, provider: 'youtube', external_id: 'abc123', collected_at: at(hoursAgoLatest + 24), views: 700, likes: 4, comments: 2, saves: 0 },
  ];
}

function postRecord(id: string, scheduleId: string | null, faceless = false): Record<string, unknown> {
  return {
    id, schedule_id: scheduleId, published_at: new Date(Date.now() - 72 * HOUR).toISOString(),
    publish_outcomes: [YT_OUTCOME], faceless,
  };
}

function get(query = ''): Promise<Response> {
  return GET(new Request(`http://localhost:3434/api/metrics/last-24h${query}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: { userId: 'user-1', accessToken: 't' }, error: null } as never);
});

describe('GET /api/metrics/last-24h', () => {
  it('returns the views and engagement gained in the last 24 hours in the contract shape', async () => {
    mockTables({
      post_metrics_daily: { data: dailyRows('post-1'), error: null },
      scheduled_posts: { data: [postRecord('post-1', 'sch-1')], error: null },
      schedules: { data: [{ id: 'sch-1', persona_id: PERSONA }], error: null },
    });
    const response = await get();
    expect(response.status).toBe(200);
    expect(applyRateLimit).toHaveBeenCalled();
    const body = await response.json();
    expect(Last24hResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      success: true,
      totals: { views: 300, engagement: 6, videos: 1, measurements: 1 },
      skipped: { noBaseline: 0, stale: 0 },
      counterResets: 0,
      truncated: false,
    });
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ postId: 'post-1', personaId: PERSONA, views: 300, baseline: 'reading' });
  });

  it('answers 401 without a session and reads nothing', async () => {
    const { NextResponse } = await import('next/server');
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    } as never);
    const { invocations } = mockTables({});
    const response = await get();
    expect(response.status).toBe(401);
    expect(invocations).toEqual([]);
  });

  it('answers the rate limiter response before reading anything', async () => {
    const { NextResponse } = await import('next/server');
    vi.mocked(applyRateLimit).mockResolvedValueOnce(NextResponse.json({ error: 'slow down' }, { status: 429 }) as never);
    const { invocations } = mockTables({});
    const response = await get();
    expect(response.status).toBe(429);
    expect(invocations).toEqual([]);
  });

  it.each([
    ['?window=24h', 'Unknown parameter: window.'],
    ['?angle=myth', 'Unknown parameter: angle.'],
    ['?persona=not-a-uuid', `persona must be a uuid or ${METRICS_NONE}.`],
    ['?provider=tiktok', 'Unknown provider.'],
    ['?account=a&account=b', 'Duplicate account parameter.'],
  ])('answers 400 for %s without touching the database', async (query, message) => {
    const { invocations } = mockTables({});
    const response = await get(query);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(message);
    expect(invocations).toEqual([]);
  });

  it('applies the persona, account and provider filters', async () => {
    mockTables({
      post_metrics_daily: { data: dailyRows('post-1'), error: null },
      scheduled_posts: { data: [postRecord('post-1', 'sch-1')], error: null },
      schedules: { data: [{ id: 'sch-1', persona_id: PERSONA }], error: null },
    });
    const match = await (await get(`?persona=${PERSONA}&account=yt&provider=youtube`)).json();
    expect(match.rows).toHaveLength(1);
    const wrongPersona = await (await get(`?persona=${OTHER_PERSONA}`)).json();
    expect(wrongPersona.rows).toEqual([]);
    const wrongAccount = await (await get('?account=other')).json();
    expect(wrongAccount.rows).toEqual([]);
    const none = await (await get(`?persona=${encodeURIComponent(METRICS_NONE)}`)).json();
    expect(none.rows).toEqual([]);
  });

  it('limits a persona-scoped API key to its personas plus faceless posts', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: 'user-1', isApiKey: true, personaIds: [PERSONA] }, error: null,
    } as never);
    mockTables({
      post_metrics_daily: {
        data: [...dailyRows('in-scope'), ...dailyRows('out-of-scope'), ...dailyRows('faceless'), ...dailyRows('orphan')],
        error: null,
      },
      scheduled_posts: {
        data: [
          postRecord('in-scope', 'sch-in'),
          postRecord('out-of-scope', 'sch-out'),
          postRecord('faceless', null, true),
          postRecord('orphan', null, false),
        ],
        error: null,
      },
      schedules: { data: [{ id: 'sch-in', persona_id: PERSONA }, { id: 'sch-out', persona_id: OTHER_PERSONA }], error: null },
    });
    const body = await (await get()).json();
    expect(body.rows.map((row: { postId: string }) => row.postId).sort()).toEqual(['faceless', 'in-scope']);
    expect(body.totals.measurements).toBe(2);
  });

  it('shows a scoped key with no personas only faceless posts and ignores non-uuid scope ids', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: 'user-1', isApiKey: true, personaIds: ['not-a-uuid'] }, error: null,
    } as never);
    mockTables({
      post_metrics_daily: { data: [...dailyRows('in-scope'), ...dailyRows('faceless')], error: null },
      scheduled_posts: { data: [postRecord('in-scope', 'sch-in'), postRecord('faceless', null, true)], error: null },
      schedules: { data: [{ id: 'sch-in', persona_id: 'not-a-uuid' }], error: null },
    });
    const body = await (await get()).json();
    expect(body.rows.map((row: { postId: string }) => row.postId)).toEqual(['faceless']);
  });

  it('answers 500 and logs when a query fails', async () => {
    mockTables({ post_metrics_daily: { data: null, error: { message: 'db down' } } });
    const response = await get();
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('Failed to load metrics.');
    expect(logger.error).toHaveBeenCalledWith('[api/metrics/last-24h] query failed', expect.any(Error));
  });
});
