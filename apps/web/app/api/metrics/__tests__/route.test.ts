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
    ...overrides,
  };
}

// Records every chained filter; `limit` resolves the query like supabase-js.
function mockQuery(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'in', 'or', 'order']) {
    builder[method] = vi.fn((...args: unknown[]) => { calls.push([method, ...args]); return builder; });
  }
  builder.limit = vi.fn(async (...args: unknown[]) => { calls.push(['limit', ...args]); return result; });
  const from = vi.fn(() => builder);
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
      rows: [{
        postId: 'post-1', personaId: PERSONA, provider: 'youtube', accountId: 'yt', externalId: 'v1',
        scriptAngle: 'myth', views: 10, likes: 2, comments: 1, saves: null, collectedAt: '2026-10-21T12:00:00Z',
      }],
    });
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
