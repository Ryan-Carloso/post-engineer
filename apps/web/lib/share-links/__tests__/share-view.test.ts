import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSupabase } from './fake-supabase';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { logger } from '@/lib/logger';
import { loadShareView, weekBounds } from '../share-view';
import { SHARE_POSTS_LIMIT } from '../share-view-types';

const USER = '11111111-1111-4111-8111-111111111111';
const PERSONA_A = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-18T15:30:00.000Z');

function metricRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: 'youtube',
    views: 100,
    likes: 10,
    comments: 5,
    saves: 1,
    collected_at: '2026-11-17T10:00:00.000Z',
    ...overrides,
  };
}

function postRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Morning routine',
    slot_at: '2026-11-18T09:00:00.000Z',
    status: 'published',
    providers: ['youtube', 'instagram'],
    ...overrides,
  };
}

function supabaseWith(metrics: unknown, posts: unknown) {
  return fakeSupabase({
    results: { post_metrics: [{ data: metrics, error: null }] },
    rpc: { share_week_posts: { data: posts, error: null } },
  });
}

describe('weekBounds', () => {
  it('starts the week on the UTC Monday and spans seven days', () => {
    const { from, to } = weekBounds(NOW);
    expect(from.toISOString()).toBe('2026-11-16T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-23T00:00:00.000Z');
  });

  it('keeps Sunday in the week that began six days earlier', () => {
    const { from, to } = weekBounds(new Date('2026-11-22T23:59:59.000Z'));
    expect(from.toISOString()).toBe('2026-11-16T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-23T00:00:00.000Z');
  });

  it('starts a new week on Monday 00:00 UTC', () => {
    expect(weekBounds(new Date('2026-11-23T00:00:00.000Z')).from.toISOString()).toBe('2026-11-23T00:00:00.000Z');
  });
});

describe('loadShareView', () => {
  beforeEach(() => {
    vi.mocked(logger.warn).mockClear();
  });

  it('totals views and engagement overall and per network, best network first', async () => {
    const fake = supabaseWith(
      [
        metricRow({ provider: 'instagram', views: 30, likes: 3, comments: 0, saves: 0 }),
        metricRow({ provider: 'youtube', views: 100, likes: 10, comments: 5, saves: 1 }),
        metricRow({ provider: 'youtube', views: 50, likes: null, comments: 2, saves: null, collected_at: '2026-11-18T08:00:00.000Z' }),
      ],
      [],
    );
    const view = await loadShareView(fake.client, { userId: USER, personaIds: null }, NOW);
    expect(view.window).toBe('7d');
    expect(view.summary).toEqual({ measurements: 3, views: 180, engagement: 21 });
    expect(view.byProvider).toEqual([
      { provider: 'youtube', measurements: 2, views: 150, engagement: 18 },
      { provider: 'instagram', measurements: 1, views: 30, engagement: 3 },
    ]);
    expect(view.asOf).toBe('2026-11-18T08:00:00.000Z');
    expect(view.metricsTruncated).toBe(false);
  });

  it('reads the owner 7d snapshots only and selects no account, video or persona identifiers', async () => {
    const fake = supabaseWith([], []);
    await loadShareView(fake.client, { userId: USER, personaIds: null }, NOW);
    const [query] = fake.queries;
    expect(query.table).toBe('post_metrics');
    expect(query.calls).toContainEqual(['eq', 'user_id', USER]);
    expect(query.calls).toContainEqual(['eq', 'metrics_window', '7d']);
    const select = query.calls.find((call) => call[0] === 'select')?.[1];
    expect(select).toBe('provider, views, likes, comments, saves, collected_at');
    expect(query.calls.some((call) => call[0] === 'in')).toBe(false);
  });

  it('limits the metrics query to the link personas when the link is scoped', async () => {
    const fake = supabaseWith([], []);
    await loadShareView(fake.client, { userId: USER, personaIds: [PERSONA_A] }, NOW);
    expect(fake.queries[0].calls).toContainEqual(['in', 'persona_id', [PERSONA_A]]);
    expect(fake.rpcCalls[0].args.p_persona_ids).toEqual([PERSONA_A]);
  });

  it('passes an empty persona scope through instead of widening it', async () => {
    const fake = supabaseWith([], []);
    await loadShareView(fake.client, { userId: USER, personaIds: [] }, NOW);
    expect(fake.queries[0].calls).toContainEqual(['in', 'persona_id', []]);
    expect(fake.rpcCalls[0].args.p_persona_ids).toEqual([]);
  });

  it('asks the week posts function for the owner and the UTC week with one probe row', async () => {
    const fake = supabaseWith([], []);
    await loadShareView(fake.client, { userId: USER, personaIds: null }, NOW);
    expect(fake.rpcCalls).toEqual([
      {
        fn: 'share_week_posts',
        args: {
          p_user_id: USER,
          p_persona_ids: null,
          p_from: '2026-11-16T00:00:00.000Z',
          p_to: '2026-11-23T00:00:00.000Z',
          p_limit: SHARE_POSTS_LIMIT + 1,
        },
      },
    ]);
  });

  it('returns only title, time, status and networks for each post', async () => {
    const fake = supabaseWith([], [postRow({ id: 'leak', task_id: 'leak', error: 'boom', providers: ['youtube', 'not-a-network'] })]);
    const view = await loadShareView(fake.client, { userId: USER, personaIds: null }, NOW);
    expect(view.posts).toEqual([
      { title: 'Morning routine', slotAt: '2026-11-18T09:00:00.000Z', status: 'published', providers: ['youtube'] },
    ]);
    expect(Object.keys(view).sort()).toEqual(
      ['asOf', 'byProvider', 'metricsTruncated', 'posts', 'postsTruncated', 'summary', 'weekEnd', 'weekStart', 'window'],
    );
  });

  it('keeps an untitled post with a null title', async () => {
    const fake = supabaseWith([], [postRow({ title: null })]);
    const view = await loadShareView(fake.client, { userId: USER, personaIds: null }, NOW);
    expect(view.posts[0].title).toBeNull();
  });

  it('skips and logs a post row it cannot read, and a row with a cancelled status', async () => {
    const fake = supabaseWith([], [postRow({ status: 'cancelled' }), postRow({ slot_at: 5 }), 'oops', postRow()]);
    const view = await loadShareView(fake.client, { userId: USER, personaIds: null }, NOW);
    expect(view.posts).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledWith('[share-view] skipped a post row that could not be read');
  });

  it('skips and logs a metrics row with an unknown network', async () => {
    const fake = supabaseWith([metricRow({ provider: 'myspace' }), metricRow()], []);
    const view = await loadShareView(fake.client, { userId: USER, personaIds: null }, NOW);
    expect(view.summary.measurements).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith('[share-view] skipped a metrics row that could not be read');
  });

  it('flags truncated posts and drops the probe row', async () => {
    const rows = Array.from({ length: SHARE_POSTS_LIMIT + 1 }, (_, index) => postRow({ title: `post ${index}` }));
    const view = await loadShareView(supabaseWith([], rows).client, { userId: USER, personaIds: null }, NOW);
    expect(view.postsTruncated).toBe(true);
    expect(view.posts).toHaveLength(SHARE_POSTS_LIMIT);
  });

  it('does not flag posts at exactly the limit', async () => {
    const rows = Array.from({ length: SHARE_POSTS_LIMIT }, () => postRow());
    const view = await loadShareView(supabaseWith([], rows).client, { userId: USER, personaIds: null }, NOW);
    expect(view.postsTruncated).toBe(false);
  });

  it('flags truncated metrics and counts only the capped rows', async () => {
    const rows = Array.from({ length: 501 }, () => metricRow());
    const view = await loadShareView(supabaseWith(rows, []).client, { userId: USER, personaIds: null }, NOW);
    expect(view.metricsTruncated).toBe(true);
    expect(view.summary.measurements).toBe(500);
  });

  it('fails instead of showing a partial page when the metrics query errors', async () => {
    const fake = fakeSupabase({
      results: { post_metrics: [{ data: null, error: { message: 'db down' } }] },
      rpc: { share_week_posts: { data: [], error: null } },
    });
    await expect(loadShareView(fake.client, { userId: USER, personaIds: null }, NOW)).rejects.toThrow('share metrics query failed: db down');
  });

  it('fails instead of showing a partial page when the posts function errors', async () => {
    const fake = fakeSupabase({
      results: { post_metrics: [{ data: [], error: null }] },
      rpc: { share_week_posts: { data: null, error: { message: 'rpc down' } } },
    });
    await expect(loadShareView(fake.client, { userId: USER, personaIds: null }, NOW)).rejects.toThrow('share posts query failed: rpc down');
  });
});
