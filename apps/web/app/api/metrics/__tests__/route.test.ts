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
import { METRICS_NONE, METRICS_ROW_LIMIT } from '@/lib/metrics/metrics-query';

const PERSONA = '11111111-2222-4333-8444-555555555555';

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    post_id: 'post-1', persona_id: PERSONA, provider: 'youtube', account_id: 'yt', external_id: 'v1',
    script_angle: 'myth', views: 10, likes: 2, comments: 1, saves: null, collected_at: '2026-10-21T12:00:00Z',
    // Migration 039 columns: null on non-YouTube or not-collected rows.
    analytics_status: null, analytics_views: null, engaged_views: null, average_view_duration_seconds: null,
    average_view_percentage: null, content_type: null, analytics_end_date: null,
    ...overrides,
  };
}

// Records every chained filter; `limit` resolves the query like supabase-js.
// Pass per-table results to give each table its own rows.
function mockQuery(
  result: { data: unknown; error: unknown },
  tables?: Record<string, { data: unknown; error: unknown }>,
) {
  const calls: Array<[string, ...unknown[]]> = [];
  const from = vi.fn((table: string) => {
    // A per-table result overrides the shared one for that table only.
    const tableBuilder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'is', 'in', 'or', 'order', 'gte']) {
      tableBuilder[method] = vi.fn((...args: unknown[]) => { calls.push([method, ...args]); return tableBuilder; });
    }
    tableBuilder.limit = vi.fn(async (...args: unknown[]) => {
      calls.push(['limit', ...args]);
      return tables?.[table] ?? result;
    });
    return tableBuilder;
  });
  vi.mocked(createSupabaseServiceClient).mockReturnValue({ from } as never);
  return { calls, from };
}

function get(query: string): Promise<Response> {
  return GET(new Request(`http://localhost:3434/api/metrics${query}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: { userId: 'user-1', accessToken: 't' }, error: null } as never);
});

describe('GET /api/metrics', () => {
  it('returns the caller rows for the window, filtered by user_id', async () => {
    const { calls, from } = mockQuery({ data: [row()], error: null });
    const response = await get('?window=24h');

    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith('post_metrics');
    expect(calls).toContainEqual(['eq', 'user_id', 'user-1']);
    expect(calls).toContainEqual(['eq', 'metrics_window', '24h']);
    expect(calls).toContainEqual(['limit', METRICS_ROW_LIMIT + 1]);
    expect(applyRateLimit).toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      success: true,
      truncated: false,
      coverage: [],
      coverageTruncated: false,
      asOf: '2026-10-21T12:00:00Z',
      rows: [{
        postId: 'post-1', personaId: PERSONA, provider: 'youtube', accountId: 'yt', externalId: 'v1',
        scriptAngle: 'myth', views: 10, likes: 2, comments: 1, saves: null, collectedAt: '2026-10-21T12:00:00Z',
        analyticsViews: null, engagedViews: null, stayedToWatchPct: null, averageViewDurationSeconds: null,
        averageViewPercentage: null, contentType: null, analyticsStatus: null, provisional: false,
      }],
    });
  });

  it('maps the YouTube Analytics columns, derives stayed-to-watch and the provisional flag', async () => {
    const { calls } = mockQuery({
      data: [
        row({
          analytics_status: 'ok', analytics_views: 1000, engaged_views: 641, average_view_duration_seconds: '21.4',
          average_view_percentage: 78.2, content_type: 'SHORTS', analytics_end_date: '2026-10-21',
        }),
        row({
          post_id: 'post-2', analytics_status: 'ok', analytics_views: 0, engaged_views: 0,
          analytics_end_date: '2026-10-18', collected_at: '2026-10-21T12:00:00Z',
        }),
        row({ post_id: 'post-3', analytics_status: 'scope_missing' }),
        row({ post_id: 'post-4', analytics_status: 'garbage' }),
      ],
      error: null,
    });
    const response = await get('?window=28d');
    expect(calls).toContainEqual(['eq', 'metrics_window', '28d']);
    const selected = calls.find(([method]) => method === 'select')?.[1];
    expect(typeof selected === 'string' ? selected : '').toContain('engaged_views, average_view_duration_seconds');
    const body: unknown = await response.json();
    const rows = typeof body === 'object' && body !== null && 'rows' in body && Array.isArray(body.rows) ? body.rows : [];
    expect(rows[0]).toMatchObject({
      analyticsViews: 1000, engagedViews: 641, stayedToWatchPct: 64.1, averageViewDurationSeconds: 21.4,
      averageViewPercentage: 78.2, contentType: 'SHORTS', analyticsStatus: 'ok', provisional: true,
    });
    // 0 views is no signal (null), never 0%; a range ending 3+ days before collection is final.
    expect(rows[1]).toMatchObject({ stayedToWatchPct: null, provisional: false });
    expect(rows[2]).toMatchObject({ analyticsStatus: 'scope_missing', engagedViews: null, stayedToWatchPct: null });
    // An unknown stored status never reaches the client.
    expect(rows[3]).toMatchObject({ analyticsStatus: null });
  });

  it('applies every filter, with the none sentinel mapping to null', async () => {
    const { calls } = mockQuery({ data: [], error: null });
    await get(`?window=7d&persona=${PERSONA}&account=yt&provider=youtube&angle=myth`);
    expect(calls).toContainEqual(['eq', 'persona_id', PERSONA]);
    expect(calls).toContainEqual(['eq', 'account_id', 'yt']);
    expect(calls).toContainEqual(['eq', 'provider', 'youtube']);
    expect(calls).toContainEqual(['eq', 'script_angle', 'myth']);

    const second = mockQuery({ data: [], error: null });
    await get(`?window=7d&persona=${encodeURIComponent(METRICS_NONE)}&angle=${encodeURIComponent(METRICS_NONE)}`);
    expect(second.calls).toContainEqual(['is', 'persona_id', null]);
    expect(second.calls).toContainEqual(['is', 'script_angle', null]);

    const third = mockQuery({ data: [], error: null });
    await get('?window=7d&angle=none');
    expect(third.calls).toContainEqual(['eq', 'script_angle', 'none']);
  });

  it('limits a persona-scoped API key to its personas plus persona-less rows', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: 'user-1', isApiKey: true, personaIds: [PERSONA] }, error: null,
    } as never);
    const { calls } = mockQuery({ data: [], error: null });
    await get('?window=24h');
    // Persona-less (faceless) rows belong to no persona scope and stay
    // visible, mirroring GET /api/schedule/status.
    expect(calls).toContainEqual(['or', `persona_id.in.(${PERSONA}),persona_id.is.null`]);
  });

  it('limits a persona-scoped API key with no personas to persona-less rows', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: 'user-1', isApiKey: true, personaIds: [] }, error: null,
    } as never);
    const { calls } = mockQuery({ data: [], error: null });
    await get('?window=24h');
    expect(calls).toContainEqual(['is', 'persona_id', null]);
  });

  it('limits a persona-scoped API key coverage to its personas plus persona-less posts', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: 'user-1', isApiKey: true, personaIds: [PERSONA] }, error: null,
    } as never);
    // Published 25h ago: the 24h window is open, so the missing targets
    // are retrying items.
    const publishedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const youtube = { provider: 'youtube', accountId: 'yt', status: 'published', videoUrl: 'https://youtu.be/v2' };
    mockQuery(
      { data: [], error: null },
      {
        scheduled_posts: {
          data: [
            { id: 'post-own', schedule_id: 'sched-own', user_id: 'user-1', status: 'published', published_at: publishedAt, publish_outcomes: [youtube] },
            { id: 'post-other', schedule_id: 'sched-other', user_id: 'user-1', status: 'published', published_at: publishedAt, publish_outcomes: [youtube] },
            { id: 'post-faceless', schedule_id: 'sched-gone', user_id: 'user-1', status: 'published', published_at: publishedAt, publish_outcomes: [youtube] },
          ],
          error: null,
        },
        schedules: {
          data: [
            { id: 'sched-own', persona_id: PERSONA },
            { id: 'sched-other', persona_id: 'other-persona' },
          ],
          error: null,
        },
        post_metrics_done: { data: [], error: null },
        post_metrics: { data: [], error: null },
      },
    );
    const body = await (await get('?window=24h')).json();
    expect(body.coverage.map((item: { postId: string }) => item.postId).sort()).toEqual(['post-faceless', 'post-own']);
  });

  it('drops malformed stored persona ids before building the scope filter', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: 'user-1', isApiKey: true, personaIds: ['bad,id)', PERSONA] }, error: null,
    } as never);
    const { calls } = mockQuery({ data: [], error: null });
    await get('?window=24h');
    expect(calls).toContainEqual(['or', `persona_id.in.(${PERSONA}),persona_id.is.null`]);

    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: 'user-1', isApiKey: true, personaIds: ['bad,id)'] }, error: null,
    } as never);
    const second = mockQuery({ data: [], error: null });
    await get('?window=24h');
    expect(second.calls).toContainEqual(['is', 'persona_id', null]);
  });

  it('returns the rate-limit response before parsing or querying', async () => {
    vi.mocked(applyRateLimit).mockResolvedValueOnce(new Response('slow down', { status: 429 }) as never);
    const { calls } = mockQuery({ data: [], error: null });
    const response = await get('?window=24h');
    expect(response.status).toBe(429);
    expect(calls).toHaveLength(0);
  });

  it('logs a stable template for 400s instead of the caller-controlled detail', async () => {
    mockQuery({ data: [], error: null });
    const response = await get('?window=24h&bogus=1');
    expect(response.status).toBe(400);
    expect(logger.warn).toHaveBeenCalledWith(
      '[GET /api/metrics] 400 Invalid metrics query.',
      expect.objectContaining({ detail: expect.stringContaining('bogus') }),
    );
  });

  it('flags truncation when more rows than the cap exist', async () => {
    mockQuery({ data: Array.from({ length: METRICS_ROW_LIMIT + 1 }, (_, i) => row({ external_id: `v${i}` })), error: null });
    const body = await (await get('?window=24h')).json();
    expect(body.truncated).toBe(true);
    expect(body.rows).toHaveLength(METRICS_ROW_LIMIT);
  });

  it('logs and drops rows with an unknown provider', async () => {
    mockQuery({ data: [row({ provider: 'tiktok' })], error: null });
    const body = await (await get('?window=24h')).json();
    expect(body.rows).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('[api/metrics] skipped row with unknown provider', { provider: 'tiktok' });
  });

  it.each([
    [''],
    ['?window=30d'],
    ['?window=24h&persona=abc'],
    ['?window=24h&provider=tiktok'],
    ['?window=24h&foo=1'],
    ['?window=24h&window=7d'],
    ['?window=24h&account='],
  ])('rejects %s with 400 before querying', async (query) => {
    const { from } = mockQuery({ data: [], error: null });
    const response = await get(query);
    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('returns a logged 500 on a query error', async () => {
    mockQuery({ data: null, error: { message: 'boom' } });
    const response = await get('?window=24h');
    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith('[api/metrics] query failed', { message: 'boom' });
  });

  it('returns coverage for a published video with no snapshot, and asOf as the newest collected_at', async () => {
    // Published 25h ago: the 24h window opened an hour ago, so the
    // missing YouTube target is retrying, not pending or missed.
    const publishedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    mockQuery(
      { data: [row(), row({ post_id: 'post-2', collected_at: '2026-10-22T08:00:00Z' })], error: null },
      {
        scheduled_posts: {
          data: [{
            id: 'post-2', schedule_id: 'sched-1', user_id: 'user-1', status: 'published',
            published_at: publishedAt,
            publish_outcomes: [{ provider: 'youtube', accountId: 'yt', status: 'published', videoUrl: 'https://youtu.be/v2' }],
          }],
          error: null,
        },
        schedules: { data: [{ id: 'sched-1', persona_id: PERSONA }], error: null },
        post_metrics_done: { data: [], error: null },
        // The coverage rows read shares the table with the dashboard rows:
        // same rows here, so the target (external id v2) is still missing.
        post_metrics: { data: [row(), row({ post_id: 'post-2', collected_at: '2026-10-22T08:00:00Z' })], error: null },
      },
    );
    const body = await (await get('?window=24h')).json();
    expect(body.asOf).toBe('2026-10-22T08:00:00Z');
    expect(body.coverageTruncated).toBe(false);
    expect(body.coverage).toEqual([expect.objectContaining({
      postId: 'post-2', provider: 'youtube', accountId: 'yt', externalId: 'v2',
      reason: 'retrying', personaId: PERSONA, publishedAt,
    })]);
  });

  it('serves the rows with empty coverage when the coverage read fails', async () => {
    mockQuery(
      { data: [row()], error: null },
      { scheduled_posts: { data: null, error: { message: 'boom' } } },
    );
    const response = await get('?window=24h');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rows).toHaveLength(1);
    expect(body.coverage).toEqual([]);
    expect(body.coverageTruncated).toBe(false);
    expect(logger.error).toHaveBeenCalledWith('[api/metrics] coverage lookup failed', expect.any(Error));
  });

  it('returns the auth error without querying', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: null, error: new Response(null, { status: 401 }),
    } as never);
    const { from } = mockQuery({ data: [], error: null });
    const response = await get('?window=24h');
    expect(response.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });
});
