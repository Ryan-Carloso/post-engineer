import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('../youtube-account-resolution', () => ({ resolveYouTubeMetricsTarget: vi.fn() }));

vi.mock('@/lib/social-accounts', () => ({
  isPlaceholderProviderAccountId: (id: string): boolean => ['', 'unknown'].includes(id.trim().toLowerCase()),
}));

import { resolveYouTubeMetricsTarget } from '../youtube-account-resolution';
import { LAST_24H_LOOKBACK_MS } from '../last-24h';
import { LAST_24H_READINGS_LIMIT, fetchLast24h } from '../last-24h-fetch';
import type { Last24hQuery } from '../metrics-query';
import { logger } from '@/lib/logger';

const NOW = new Date('2026-11-22T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const PERSONA = '11111111-2222-4333-8444-555555555555';
const YT_OUTCOME = { provider: 'youtube', accountId: 'yt', status: 'published', videoUrl: 'https://www.youtube.com/shorts/abc123' };

type Result = { data: unknown; error: unknown };
type Call = [string, ...unknown[]];

function mockSupabase(tables: Record<string, Result | Result[]>): {
  client: SupabaseClient;
  invocations: Array<{ table: string; calls: Call[] }>;
} {
  const invocations: Array<{ table: string; calls: Call[] }> = [];
  const used = new Map<string, number>();
  const from = vi.fn((table: string) => {
    const calls: Call[] = [];
    invocations.push({ table, calls });
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'gte', 'order']) {
      builder[method] = vi.fn((...args: unknown[]) => { calls.push([method, ...args]); return builder; });
    }
    builder.limit = vi.fn(async (...args: unknown[]) => {
      calls.push(['limit', ...args]);
      const configured = tables[table];
      if (Array.isArray(configured)) {
        const index = used.get(table) ?? 0;
        used.set(table, index + 1);
        return configured[Math.min(index, configured.length - 1)];
      }
      return configured ?? { data: [], error: null };
    });
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, invocations };
}

function dailyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    post_id: 'post-1', provider: 'youtube', external_id: 'abc123',
    collected_at: new Date(NOW.getTime() - HOUR).toISOString(),
    views: 1000, likes: 10, comments: 1, saves: null,
    ...overrides,
  };
}

function postRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'post-1', schedule_id: 'sch-1', published_at: new Date(NOW.getTime() - 72 * HOUR).toISOString(),
    publish_outcomes: [YT_OUTCOME], voiceover: false,
    ...overrides,
  };
}

const QUERY: Last24hQuery = { personaId: null, accountId: null, provider: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchLast24h', () => {
  it('reads only the caller readings inside the lookback, newest first, with a hard limit', async () => {
    const { client, invocations } = mockSupabase({ post_metrics_daily: { data: [], error: null } });
    const result = await fetchLast24h(client, 'user-1', QUERY, NOW);

    expect(invocations).toHaveLength(1);
    const { table, calls } = invocations[0];
    expect(table).toBe('post_metrics_daily');
    expect(calls).toContainEqual(['select', 'post_id, provider, external_id, collected_at, views, likes, comments, saves']);
    expect(calls).toContainEqual(['eq', 'user_id', 'user-1']);
    expect(calls).toContainEqual(['gte', 'collected_at', new Date(NOW.getTime() - LAST_24H_LOOKBACK_MS).toISOString()]);
    expect(calls).toContainEqual(['order', 'collected_at', { ascending: false }]);
    expect(calls).toContainEqual(['order', 'id', { ascending: true }]);
    expect(calls).toContainEqual(['limit', LAST_24H_READINGS_LIMIT]);
    expect(result).toMatchObject({ rows: [], truncated: false, asOf: null });
  });

  it('computes the delta from the readings and the persona, post and outcomes of each post', async () => {
    const { client, invocations } = mockSupabase({
      post_metrics_daily: {
        data: [dailyRow(), dailyRow({ collected_at: new Date(NOW.getTime() - 25 * HOUR).toISOString(), views: 700, likes: 4 })],
        error: null,
      },
      scheduled_posts: { data: [postRow()], error: null },
      schedules: { data: [{ id: 'sch-1', persona_id: PERSONA }], error: null },
    });
    const result = await fetchLast24h(client, 'user-1', QUERY, NOW);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ postId: 'post-1', personaId: PERSONA, accountId: 'yt', views: 300, likes: 6, baseline: 'reading' });
    expect(result.totals).toMatchObject({ views: 300, engagement: 6, videos: 1, measurements: 1 });

    const posts = invocations.find((inv) => inv.table === 'scheduled_posts');
    expect(posts?.calls).toContainEqual(['eq', 'user_id', 'user-1']);
    expect(posts?.calls).toContainEqual(['in', 'id', ['post-1']]);
    expect(posts?.calls).toContainEqual(['limit', 1]);
    const schedules = invocations.find((inv) => inv.table === 'schedules');
    expect(schedules?.calls).toContainEqual(['eq', 'user_id', 'user-1']);
    expect(schedules?.calls).toContainEqual(['in', 'id', ['sch-1']]);
  });

  it('reads the posts and schedules of the readings only, not the whole table', async () => {
    const { client, invocations } = mockSupabase({
      post_metrics_daily: { data: [dailyRow({ post_id: 'a' }), dailyRow({ post_id: 'a', external_id: 'other' }), dailyRow({ post_id: 'b' })], error: null },
      scheduled_posts: { data: [], error: null },
    });
    await fetchLast24h(client, 'user-1', QUERY, NOW);
    const posts = invocations.find((inv) => inv.table === 'scheduled_posts');
    expect(posts?.calls).toContainEqual(['in', 'id', ['a', 'b']]);
  });

  it('chunks the post id lookup so no request carries more than 100 ids', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `post-${i}`);
    const { client, invocations } = mockSupabase({
      post_metrics_daily: { data: ids.map((id) => dailyRow({ post_id: id })), error: null },
      scheduled_posts: { data: [], error: null },
    });
    await fetchLast24h(client, 'user-1', QUERY, NOW);
    const lookups = invocations.filter((inv) => inv.table === 'scheduled_posts');
    expect(lookups).toHaveLength(3);
    expect(lookups.map((inv) => (inv.calls.find((call) => call[0] === 'in')?.[2] as string[]).length)).toEqual([100, 100, 50]);
  });

  it('makes no post or schedule query when there are no readings', async () => {
    const { client, invocations } = mockSupabase({ post_metrics_daily: { data: [], error: null } });
    await fetchLast24h(client, 'user-1', QUERY, NOW);
    expect(invocations.map((inv) => inv.table)).toEqual(['post_metrics_daily']);
  });

  it('reports truncated and logs when the readings read hits its cap', async () => {
    const data = Array.from({ length: LAST_24H_READINGS_LIMIT }, (_, i) => dailyRow({ post_id: `p${i}` }));
    const { client } = mockSupabase({ post_metrics_daily: { data, error: null }, scheduled_posts: { data: [], error: null } });
    const result = await fetchLast24h(client, 'user-1', QUERY, NOW);
    expect(result.truncated).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith('[metrics-last-24h] readings read hit its cap; older readings were not read', { userId: 'user-1' });
  });

  it('is not truncated one reading under the cap', async () => {
    const data = Array.from({ length: LAST_24H_READINGS_LIMIT - 1 }, (_, i) => dailyRow({ post_id: `p${i}` }));
    const { client } = mockSupabase({ post_metrics_daily: { data, error: null }, scheduled_posts: { data: [], error: null } });
    expect((await fetchLast24h(client, 'user-1', QUERY, NOW)).truncated).toBe(false);
  });

  it('scopes the result to the persona ids it is given', async () => {
    const { client } = mockSupabase({
      post_metrics_daily: { data: [dailyRow(), dailyRow({ collected_at: new Date(NOW.getTime() - 25 * HOUR).toISOString(), views: 1 })], error: null },
      scheduled_posts: { data: [postRow()], error: null },
      schedules: { data: [{ id: 'sch-1', persona_id: PERSONA }], error: null },
    });
    const hidden = await fetchLast24h(client, 'user-1', QUERY, NOW, { personaIds: ['99999999-2222-4333-8444-555555555555'] });
    expect(hidden.rows).toEqual([]);
    const shown = await fetchLast24h(client, 'user-1', QUERY, NOW, { personaIds: [PERSONA] });
    expect(shown.rows).toHaveLength(1);
  });

  it('treats a post whose schedule is gone as persona-less and not voiceover, hiding it from a scoped key', async () => {
    const { client } = mockSupabase({
      post_metrics_daily: { data: [dailyRow(), dailyRow({ collected_at: new Date(NOW.getTime() - 25 * HOUR).toISOString(), views: 1 })], error: null },
      scheduled_posts: { data: [postRow({ schedule_id: null })], error: null },
    });
    const scoped = await fetchLast24h(client, 'user-1', QUERY, NOW, { personaIds: [PERSONA] });
    expect(scoped.rows).toEqual([]);
    const unscoped = await fetchLast24h(client, 'user-1', QUERY, NOW);
    expect(unscoped.rows).toHaveLength(1);
    expect(unscoped.rows[0]?.personaId).toBeNull();
  });

  it('skips and logs a reading row with an unknown provider and a post row without a publish date', async () => {
    const { client } = mockSupabase({
      post_metrics_daily: { data: [dailyRow({ provider: 'tiktok' }), dailyRow()], error: null },
      scheduled_posts: { data: [postRow({ published_at: null })], error: null },
    });
    const result = await fetchLast24h(client, 'user-1', QUERY, NOW);
    expect(result.rows).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('[metrics-last-24h] skipped reading with unknown provider or missing id', { provider: 'tiktok' });
    expect(logger.warn).toHaveBeenCalledWith('[metrics-last-24h] skipped post with missing id or published_at', { postId: 'post-1' });
  });

  it.each([
    ['post_metrics_daily', 'last-24h readings lookup failed: boom'],
    ['scheduled_posts', 'last-24h posts lookup failed: boom'],
    ['schedules', 'last-24h schedules lookup failed: boom'],
  ])('throws when the %s query fails', async (failing, message) => {
    const tables: Record<string, Result> = {
      post_metrics_daily: { data: [dailyRow()], error: null },
      scheduled_posts: { data: [postRow()], error: null },
      schedules: { data: [{ id: 'sch-1', persona_id: PERSONA }], error: null },
    };
    tables[failing] = { data: null, error: { message: 'boom' } };
    const { client } = mockSupabase(tables);
    await expect(fetchLast24h(client, 'user-1', QUERY, NOW)).rejects.toThrow(message);
  });

  it('treats a non-array data payload as no rows', async () => {
    const { client } = mockSupabase({ post_metrics_daily: { data: null, error: null } });
    const result = await fetchLast24h(client, 'user-1', QUERY, NOW);
    expect(result.rows).toEqual([]);
  });

  describe('placeholder YouTube accounts', () => {
    const PLACEHOLDER_OUTCOME = { ...YT_OUTCOME, accountId: 'unknown' };
    const withPlaceholderPost = (): SupabaseClient => mockSupabase({
      post_metrics_daily: { data: [dailyRow(), dailyRow({ collected_at: new Date(NOW.getTime() - 25 * HOUR).toISOString(), views: 700, likes: 4 })], error: null },
      scheduled_posts: { data: [postRow({ publish_outcomes: [PLACEHOLDER_OUTCOME] })], error: null },
      schedules: { data: [{ id: 'sch-1', persona_id: PERSONA }], error: null },
    }).client;

    it('returns the resolved channel id and honours an account filter on it', async () => {
      vi.mocked(resolveYouTubeMetricsTarget).mockResolvedValue({ provider: 'youtube', externalId: 'abc123', accountId: 'UCreal' });
      const filtered = await fetchLast24h(withPlaceholderPost(), 'user-1', { ...QUERY, accountId: 'UCreal' }, NOW);
      expect(filtered.rows).toHaveLength(1);
      expect(filtered.rows[0]?.accountId).toBe('UCreal');
      expect(resolveYouTubeMetricsTarget).toHaveBeenCalledWith('user-1', expect.objectContaining({ externalId: 'abc123', accountId: 'unknown' }));
      const other = await fetchLast24h(withPlaceholderPost(), 'user-1', { ...QUERY, accountId: 'UCother' }, NOW);
      expect(other.rows).toEqual([]);
    });

    it('keeps the stored account id and logs when the channel cannot be resolved', async () => {
      vi.mocked(resolveYouTubeMetricsTarget).mockRejectedValue(new Error('probe failed'));
      const result = await fetchLast24h(withPlaceholderPost(), 'user-1', QUERY, NOW);
      expect(result.rows[0]?.accountId).toBe('unknown');
      expect(logger.warn).toHaveBeenCalledWith('[metrics-last-24h] youtube placeholder account not resolved', {
        postId: 'post-1', externalId: 'abc123', error: 'probe failed',
      });
    });

    it('never resolves a target that already carries a real account id', async () => {
      const { client } = mockSupabase({
        post_metrics_daily: { data: [dailyRow()], error: null },
        scheduled_posts: { data: [postRow()], error: null },
      });
      await fetchLast24h(client, 'user-1', QUERY, NOW);
      expect(resolveYouTubeMetricsTarget).not.toHaveBeenCalled();
    });
  });
});
