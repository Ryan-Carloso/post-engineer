import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findRepoRoot } from '@/test/repo-root';
import {
  METRICS_ROW_LIMIT, METRICS_WINDOW_START_HOURS, METRICS_WINDOW_WIDTH_HOURS, metricsWindowRange,
  type MetricsQuery, type MetricsRowView,
} from '../metrics-query';
import { computeCoverage, fetchCoverage, type CoveragePostInput } from '../metrics-coverage';

//---------------
// Tests for metrics coverage (issue #525): published videos with no
// snapshot for the selected window, and why each one is missing.
//---------------

const NOW = new Date('2026-10-22T12:00:00.000Z');
const PERSONA = '11111111-2222-4333-8444-555555555555';

const YT_OUTCOME = { provider: 'youtube', accountId: 'yt', status: 'published', videoUrl: 'https://www.youtube.com/shorts/abc123' };
const IG_OUTCOME = { provider: 'instagram', accountId: 'ig1', status: 'published', postId: 'ig-media-1' };
const IG_FAILED_OUTCOME = { provider: 'instagram', accountId: 'ig1', status: 'failed', error: 'timeout' };
const THREADS_OUTCOME = { provider: 'threads', accountId: 'th1', status: 'published', postId: 'th-post-1' };

function post(overrides: Partial<CoveragePostInput> = {}): CoveragePostInput {
  return {
    id: 'post-1',
    personaId: PERSONA,
    publishedAt: '2026-10-21T12:00:00.000Z',
    outcomes: [YT_OUTCOME],
    ...overrides,
  };
}

function row(overrides: Partial<MetricsRowView> = {}): MetricsRowView {
  return {
    postId: 'post-1', personaId: PERSONA, provider: 'youtube', accountId: 'yt', externalId: 'abc123',
    scriptAngle: 'myth', views: 100, likes: null, comments: null, saves: null, collectedAt: '2026-10-21T12:00:00.000Z',
    analyticsViews: null, engagedViews: null, stayedToWatchPct: null, averageViewDurationSeconds: null,
    averageViewPercentage: null, contentType: null, analyticsStatus: null, provisional: false,
    ...overrides,
  };
}

function query(overrides: Partial<MetricsQuery> = {}): MetricsQuery {
  return { window: '24h', personaId: null, accountId: null, provider: null, angle: null, ...overrides };
}

function compute(
  input: Partial<Parameters<typeof computeCoverage>[0]> = {},
): ReturnType<typeof computeCoverage> {
  return computeCoverage({
    posts: [post()],
    rows: [],
    donePostIds: new Set(),
    query: query(),
    now: NOW,
    ...input,
  });
}

describe('metricsWindowRange', () => {
  it('opens start_hours after publish and closes 24h later (migration 025 bounds)', () => {
    const range = metricsWindowRange('24h', new Date('2026-10-20T12:00:00.000Z'));
    expect(range.opensAt.toISOString()).toBe('2026-10-21T12:00:00.000Z');
    expect(range.closesAt.toISOString()).toBe('2026-10-22T12:00:00.000Z');
    const week = metricsWindowRange('7d', new Date('2026-10-14T12:00:00.000Z'));
    expect(week.opensAt.toISOString()).toBe('2026-10-21T12:00:00.000Z');
    expect(week.closesAt.toISOString()).toBe('2026-10-22T12:00:00.000Z');
    const month = metricsWindowRange('28d', new Date('2026-09-24T12:00:00.000Z'));
    expect(month.opensAt.toISOString()).toBe('2026-10-22T12:00:00.000Z');
    expect(month.closesAt.toISOString()).toBe('2026-10-23T12:00:00.000Z');
  });
});

describe('metrics window hours (migrations 025/039)', () => {
  it('matches the due SQL values the collector and coverage share', () => {
    const sql = readFileSync(
      join(findRepoRoot(import.meta.url), 'supabase', 'migrations', '039_post-metrics-retention.sql'),
      'utf8',
    );
    const fn = sql.slice(sql.indexOf('create or replace function public.find_post_metrics_due'));
    // The TS constants are the single source the collector re-open and the
    // dashboard coverage compute from; the SQL is the source the due
    // query runs from. Both must agree, or a window opens in one and not
    // the other.
    const values = (Object.entries(METRICS_WINDOW_START_HOURS) as Array<[string, number]>)
      .map(([window, hours]) => `('${window}', ${hours})`)
      .join(', ');
    expect(fn).toContain(`values ${values}`);
    // The window width is the SQL's `start_hours + 24`.
    expect(fn).toContain('make_interval(hours => w.start_hours + 24)');
    expect(METRICS_WINDOW_WIDTH_HOURS).toBe(24);
  });
});

describe('computeCoverage', () => {
  it('lists a missing target as retrying while its window is open', () => {
    const { items, truncated, unknownProviders } = compute();
    expect(truncated).toBe(false);
    expect(unknownProviders).toEqual([]);
    expect(items).toEqual([{
      postId: 'post-1',
      personaId: PERSONA,
      provider: 'youtube',
      accountId: 'yt',
      externalId: 'abc123',
      scriptAngle: null,
      reason: 'retrying',
      publishedAt: '2026-10-21T12:00:00.000Z',
      windowOpensAt: '2026-10-22T12:00:00.000Z',
      windowClosesAt: '2026-10-23T12:00:00.000Z',
    }]);
  });

  it('lists a target as pending while its window has not opened yet', () => {
    const { items } = compute({ posts: [post({ publishedAt: '2026-10-21T13:00:00.000Z' })] });
    expect(items).toHaveLength(1);
    expect(items[0]?.reason).toBe('pending');
    expect(items[0]?.windowOpensAt).toBe('2026-10-22T13:00:00.000Z');
  });

  it('lists a closed-window missing target as missed when the post is not done', () => {
    const { items } = compute({ posts: [post({ publishedAt: '2026-10-20T12:00:00.000Z' })] });
    expect(items).toHaveLength(1);
    expect(items[0]?.reason).toBe('missed');
  });

  it('lists a closed-window missing target as no-target when the post is done', () => {
    const { items } = compute({
      posts: [post({ publishedAt: '2026-10-20T12:00:00.000Z' })],
      donePostIds: new Set(['post-1']),
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.reason).toBe('no-target');
  });

  it('lists a failed publish outcome as publish-failed with a null external id', () => {
    const { items } = compute({ posts: [post({ outcomes: [IG_FAILED_OUTCOME] })] });
    expect(items).toEqual([expect.objectContaining({
      provider: 'instagram',
      accountId: 'ig1',
      externalId: null,
      reason: 'publish-failed',
    })]);
  });

  it('skips targets that already have a snapshot row', () => {
    const { items } = compute({ rows: [row()] });
    expect(items).toEqual([]);
  });

  it('takes the post angle from its rows, and skips unknown-angle posts under an angle filter', () => {
    // The YouTube row is collected (angle 'myth'); the Instagram target is
    // missing, so its item inherits the post angle from the collected row.
    const withAngle = compute({
      posts: [post({ outcomes: [YT_OUTCOME, IG_OUTCOME] })],
      rows: [row()],
      query: query({ angle: 'myth' }),
    });
    expect(withAngle.items).toHaveLength(1);
    expect(withAngle.items[0]).toMatchObject({ provider: 'instagram', scriptAngle: 'myth' });

    // Same post under a different angle filter: hidden, not mislabelled.
    expect(compute({
      posts: [post({ outcomes: [YT_OUTCOME, IG_OUTCOME] })],
      rows: [row()],
      query: query({ angle: 'tutorial' }),
    }).items).toEqual([]);

    // A post with no rows at all has an unknown angle: hidden under any
    // angle filter, shown when no angle filter is set.
    expect(compute({ query: query({ angle: 'myth' }) }).items).toEqual([]);
    expect(compute().items).toHaveLength(1);
  });

  it('respects the persona, provider and account filters', () => {
    const posts = [post({ outcomes: [YT_OUTCOME, IG_OUTCOME, THREADS_OUTCOME] })];
    expect(compute({ posts, query: query({ provider: 'instagram' }) }).items.map((item) => item.provider))
      .toEqual(['instagram']);
    expect(compute({ posts, query: query({ accountId: 'th1' }) }).items.map((item) => item.provider))
      .toEqual(['threads']);
    expect(compute({ posts, query: query({ personaId: 'other-persona' }) }).items).toEqual([]);
    expect(compute({ posts, query: query({ personaId: '^@none' }) }).items).toEqual([]);
  });

  it('reports providers it does not know instead of dropping them', () => {
    const { items, unknownProviders } = compute({
      posts: [post({ outcomes: [{ provider: 'tiktok', accountId: 'a', status: 'published', postId: 'p' }] })],
    });
    expect(items).toEqual([]);
    expect(unknownProviders).toEqual(['tiktok']);
  });

  it('skips posts older than the 29-day lookback', () => {
    const { items } = compute({ posts: [post({ publishedAt: '2026-09-22T12:00:00.000Z' })] });
    expect(items).toEqual([]);
  });

  it('caps items at the row limit, newest first, and flags truncation', () => {
    const posts = Array.from({ length: METRICS_ROW_LIMIT + 1 }, (_, index) => post({
      id: `post-${index}`,
      publishedAt: '2026-10-21T12:00:00.000Z',
    }));
    const { items, truncated } = compute({ posts });
    expect(items).toHaveLength(METRICS_ROW_LIMIT);
    expect(truncated).toBe(true);
    // Deterministic order: publishedAt desc, then post id.
    expect(items[0]?.postId).toBe('post-0');
  });
});

// Records every chained filter; `limit` resolves the query like supabase-js.
function fakeClient(tables: Record<string, { data: unknown; error: unknown }>) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'gte', 'in', 'order']) {
      builder[method] = vi.fn((...args: unknown[]) => { calls.push({ table, method, args }); return builder; });
    }
    builder.limit = vi.fn(async (...args: unknown[]) => {
      calls.push({ table, method: 'limit', args });
      return tables[table] ?? { data: [], error: null };
    });
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, calls, from };
}

describe('fetchCoverage', () => {
  it('reads the user posts, their personas, the done marks and the window rows', async () => {
    const { client, calls, from } = fakeClient({
      scheduled_posts: {
        data: [{
          id: 'post-1', schedule_id: 'sched-1', user_id: 'user-1', status: 'published',
          published_at: '2026-10-21T12:00:00.000Z', publish_outcomes: [YT_OUTCOME, IG_FAILED_OUTCOME],
        }],
        error: null,
      },
      schedules: { data: [{ id: 'sched-1', persona_id: PERSONA }], error: null },
      post_metrics_done: { data: [], error: null },
      post_metrics: { data: [], error: null },
    });
    const { items, truncated } = await fetchCoverage(client, 'user-1', query(), NOW);

    expect(from).toHaveBeenCalledWith('scheduled_posts');
    expect(from).toHaveBeenCalledWith('schedules');
    expect(from).toHaveBeenCalledWith('post_metrics_done');
    expect(from).toHaveBeenCalledWith('post_metrics');
    expect(calls).toContainEqual({ table: 'scheduled_posts', method: 'eq', args: ['user_id', 'user-1'] });
    expect(calls).toContainEqual({ table: 'scheduled_posts', method: 'eq', args: ['status', 'published'] });
    expect(calls).toContainEqual({ table: 'post_metrics_done', method: 'eq', args: ['metrics_window', '24h'] });
    expect(calls).toContainEqual({ table: 'post_metrics', method: 'eq', args: ['metrics_window', '24h'] });
    expect(truncated).toBe(false);
    expect(items).toEqual([
      expect.objectContaining({ provider: 'youtube', reason: 'retrying', personaId: PERSONA }),
      expect.objectContaining({ provider: 'instagram', reason: 'publish-failed', externalId: null }),
    ]);
  });

  it('uses a null persona when the post schedule is gone', async () => {
    const { client } = fakeClient({
      scheduled_posts: {
        data: [{
          id: 'post-1', schedule_id: 'sched-gone', user_id: 'user-1', status: 'published',
          published_at: '2026-10-21T12:00:00.000Z', publish_outcomes: [YT_OUTCOME],
        }],
        error: null,
      },
      schedules: { data: [], error: null },
      post_metrics_done: { data: [], error: null },
      post_metrics: { data: [], error: null },
    });
    const { items } = await fetchCoverage(client, 'user-1', query(), NOW);
    expect(items[0]?.personaId).toBeNull();
  });

  it('skips the done-marks and rows reads when the user has no posts in scope', async () => {
    const { client, from } = fakeClient({
      scheduled_posts: { data: [], error: null },
      schedules: { data: [], error: null },
    });
    const { items, truncated } = await fetchCoverage(client, 'user-1', query(), NOW);
    expect(items).toEqual([]);
    expect(truncated).toBe(false);
    expect(from).not.toHaveBeenCalledWith('post_metrics_done');
    expect(from).not.toHaveBeenCalledWith('post_metrics');
  });

  it('throws when a read fails, so the route can degrade instead of failing the page', async () => {
    const { client } = fakeClient({
      scheduled_posts: { data: null, error: { message: 'boom' } },
      schedules: { data: [], error: null },
    });
    await expect(fetchCoverage(client, 'user-1', query(), NOW)).rejects.toThrow('coverage posts lookup failed: boom');
  });
});
