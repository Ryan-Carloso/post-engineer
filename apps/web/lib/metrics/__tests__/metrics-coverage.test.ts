import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findRepoRoot } from '@/test/repo-root';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  METRICS_NONE, METRICS_ROW_LIMIT, METRICS_WINDOW_START_HOURS, METRICS_WINDOW_WIDTH_HOURS, metricsWindowRange,
  type MetricsQuery, type MetricsRowView,
} from '../metrics-query';
import { computeCoverage, fetchCoverage, type CoveragePostInput } from '../metrics-coverage';
import { logger } from '@/lib/logger';

beforeEach(() => {
  vi.clearAllMocks();
});

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

  it('keeps one publish-failed item per (provider, account) when several videos fail there', () => {
    // Two videos of one slot failing on the same account carry no video
    // id, so without dedupe the items are identical and collide as
    // React keys.
    const { items } = compute({
      posts: [post({ outcomes: [IG_FAILED_OUTCOME, IG_FAILED_OUTCOME, { provider: 'youtube', accountId: 'yt', status: 'failed' }] })],
    });
    expect(items).toHaveLength(2);
    expect(items.filter((item) => item.provider === 'instagram')).toHaveLength(1);
    // The dedupe is per post: the same failure on another post is its
    // own item.
    const { items: twoPosts } = compute({
      posts: [
        post({ id: 'post-1', outcomes: [IG_FAILED_OUTCOME] }),
        post({ id: 'post-2', outcomes: [IG_FAILED_OUTCOME] }),
      ],
    });
    expect(twoPosts).toHaveLength(2);
  });

  it('drops out-of-scope personas for a scoped caller, keeps its own and persona-less posts', () => {
    const posts = [
      post({ id: 'post-own', personaId: PERSONA }),
      post({ id: 'post-other', personaId: 'other-persona' }),
      post({ id: 'post-faceless', personaId: null }),
    ];
    const { items } = compute({ posts, personaIds: [PERSONA] });
    expect(items.map((item) => item.postId).sort()).toEqual(['post-faceless', 'post-own']);
  });

  it('keeps only persona-less posts when the scope is empty', () => {
    const posts = [
      post({ id: 'post-own', personaId: PERSONA }),
      post({ id: 'post-faceless', personaId: null }),
    ];
    const { items } = compute({ posts, personaIds: [] });
    expect(items.map((item) => item.postId)).toEqual(['post-faceless']);
  });

  it('is unrestricted without a scope', () => {
    const posts = [
      post({ id: 'post-own', personaId: PERSONA }),
      post({ id: 'post-other', personaId: 'other-persona' }),
    ];
    expect(compute({ posts }).items).toHaveLength(2);
  });

  it('skips posts with an unparseable publish date', () => {
    const { items } = compute({ posts: [post({ publishedAt: 'not-a-date' })] });
    expect(items).toEqual([]);
  });

  it('takes a null angle from a row and shows the item with no angle', () => {
    // The YouTube target is collected; the Instagram target is missing
    // and inherits the null angle from the collected row.
    const { items } = compute({
      posts: [post({ outcomes: [YT_OUTCOME, IG_OUTCOME] })],
      rows: [row({ scriptAngle: null })],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ provider: 'instagram', scriptAngle: null });
  });

  it('keeps the first angle when a later row has none', () => {
    const { items } = compute({
      posts: [post({ outcomes: [YT_OUTCOME, IG_OUTCOME] })],
      rows: [row(), row({ scriptAngle: null })],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ provider: 'instagram', scriptAngle: 'myth' });
  });

  it('shows persona-less posts under the none persona filter, hides persona posts', () => {
    const posts = [
      post({ id: 'post-own', personaId: PERSONA }),
      post({ id: 'post-faceless', personaId: null }),
    ];
    const { items } = compute({ posts, query: query({ personaId: METRICS_NONE }) });
    expect(items.map((item) => item.postId)).toEqual(['post-faceless']);
  });

  it('hides angled posts under the none angle filter, shows angle-less ones', () => {
    expect(compute({
      posts: [post({ outcomes: [YT_OUTCOME, IG_OUTCOME] })],
      rows: [row()],
      query: query({ angle: METRICS_NONE }),
    }).items).toEqual([]);
    const shown = compute({
      posts: [post({ outcomes: [YT_OUTCOME, IG_OUTCOME] })],
      rows: [row({ scriptAngle: null })],
      query: query({ angle: METRICS_NONE }),
    });
    expect(shown.items).toHaveLength(1);
    expect(shown.items[0]).toMatchObject({ provider: 'instagram', scriptAngle: null });
  });

  it('skips non-object entries and failed entries with unknown providers or no account', () => {
    const { items } = compute({
      posts: [post({ outcomes: [
        'junk',
        null,
        { provider: 'tiktok', accountId: 'a', status: 'failed' },
        { provider: 'instagram', status: 'failed' },
        { provider: 'instagram', accountId: '', status: 'failed' },
        IG_FAILED_OUTCOME,
      ] })],
    });
    // Only the well-formed Instagram failure survives, once.
    expect(items).toEqual([expect.objectContaining({
      provider: 'instagram', accountId: 'ig1', externalId: null, reason: 'publish-failed',
    })]);
  });

  it('does not list failed publishes filtered out by provider or account', () => {
    const failed = post({ outcomes: [IG_FAILED_OUTCOME] });
    expect(compute({ posts: [failed], query: query({ provider: 'youtube' }) }).items).toEqual([]);
    expect(compute({ posts: [failed], query: query({ accountId: 'other' }) }).items).toEqual([]);
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
  function postRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'post-1', schedule_id: 'sched-1', user_id: 'user-1', status: 'published',
      published_at: '2026-10-21T12:00:00.000Z', publish_outcomes: [YT_OUTCOME],
      ...overrides,
    };
  }

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

  it('drops out-of-scope personas when the caller passes a persona scope', async () => {
    const { client } = fakeClient({
      scheduled_posts: {
        data: [
          {
            id: 'post-own', schedule_id: 'sched-own', user_id: 'user-1', status: 'published',
            published_at: '2026-10-21T12:00:00.000Z', publish_outcomes: [YT_OUTCOME],
          },
          {
            id: 'post-other', schedule_id: 'sched-other', user_id: 'user-1', status: 'published',
            published_at: '2026-10-21T12:00:00.000Z', publish_outcomes: [YT_OUTCOME],
          },
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
    });
    const { items } = await fetchCoverage(client, 'user-1', query(), NOW, { personaIds: [PERSONA] });
    expect(items.map((item) => item.postId)).toEqual(['post-own']);
  });

  it('reads only the schedules the posts reference, so a scoped key cannot leak a post past a cap', async () => {
    const { client, calls } = fakeClient({
      scheduled_posts: {
        data: [{
          id: 'post-1', schedule_id: 'sched-1', user_id: 'user-1', status: 'published',
          published_at: '2026-10-21T12:00:00.000Z', publish_outcomes: [YT_OUTCOME],
        }],
        error: null,
      },
      schedules: { data: [{ id: 'sched-1', persona_id: 'other-persona' }], error: null },
      post_metrics_done: { data: [], error: null },
      post_metrics: { data: [], error: null },
    });
    const { items } = await fetchCoverage(client, 'user-1', query(), NOW, { personaIds: [PERSONA] });
    // The referenced schedule resolves to a persona outside the scope,
    // so the post is dropped — never degraded to "no persona".
    expect(items).toEqual([]);
    expect(calls).toContainEqual({ table: 'schedules', method: 'in', args: ['id', ['sched-1']] });
    expect(calls).not.toContainEqual({ table: 'schedules', method: 'limit', args: [1000] });
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

  it('throws when the schedules read fails', async () => {
    const { client } = fakeClient({
      scheduled_posts: { data: [postRecord()], error: null },
      schedules: { data: null, error: { message: 'boom' } },
    });
    await expect(fetchCoverage(client, 'user-1', query(), NOW)).rejects.toThrow('coverage schedules lookup failed: boom');
  });

  it('throws when the done-marks read fails', async () => {
    const { client } = fakeClient({
      scheduled_posts: { data: [postRecord()], error: null },
      schedules: { data: [{ id: 'sched-1', persona_id: PERSONA }], error: null },
      post_metrics_done: { data: null, error: { message: 'boom' } },
    });
    await expect(fetchCoverage(client, 'user-1', query(), NOW)).rejects.toThrow('coverage done lookup failed: boom');
  });

  it('throws when the rows read fails', async () => {
    const { client } = fakeClient({
      scheduled_posts: { data: [postRecord()], error: null },
      schedules: { data: [{ id: 'sched-1', persona_id: PERSONA }], error: null },
      post_metrics_done: { data: [], error: null },
      post_metrics: { data: null, error: { message: 'boom' } },
    });
    await expect(fetchCoverage(client, 'user-1', query(), NOW)).rejects.toThrow('coverage rows lookup failed: boom');
  });

  it('treats non-array reads as empty', async () => {
    const { client } = fakeClient({
      scheduled_posts: { data: 'junk', error: null },
      schedules: { data: [], error: null },
    });
    const empty = await fetchCoverage(client, 'user-1', query(), NOW);
    expect(empty).toEqual({ items: [], truncated: false });

    const noPersonas = fakeClient({
      scheduled_posts: { data: [postRecord()], error: null },
      schedules: { data: 'junk', error: null },
      post_metrics_done: { data: [], error: null },
      post_metrics: { data: [], error: null },
    });
    const { items: noPersonaItems } = await fetchCoverage(noPersonas.client, 'user-1', query(), NOW);
    expect(noPersonaItems[0]?.personaId).toBeNull();

    const noDone = fakeClient({
      scheduled_posts: { data: [postRecord({ published_at: '2026-10-20T12:00:00.000Z' })], error: null },
      schedules: { data: [{ id: 'sched-1', persona_id: PERSONA }], error: null },
      post_metrics_done: { data: 'junk', error: null },
      post_metrics: { data: [], error: null },
    });
    const { items: missedItems } = await fetchCoverage(noDone.client, 'user-1', query(), NOW);
    expect(missedItems[0]?.reason).toBe('missed');

    const noRows = fakeClient({
      scheduled_posts: { data: [postRecord()], error: null },
      schedules: { data: [{ id: 'sched-1', persona_id: PERSONA }], error: null },
      post_metrics_done: { data: [], error: null },
      post_metrics: { data: 'junk', error: null },
    });
    const { items: retryingItems } = await fetchCoverage(noRows.client, 'user-1', query(), NOW);
    expect(retryingItems).toHaveLength(1);
    expect(retryingItems[0]?.reason).toBe('retrying');
  });

  it('treats a non-string persona id as no persona', async () => {
    const { client } = fakeClient({
      scheduled_posts: { data: [postRecord()], error: null },
      schedules: { data: [{ id: 'sched-1', persona_id: 123 }], error: null },
      post_metrics_done: { data: [], error: null },
      post_metrics: { data: [], error: null },
    });
    const { items } = await fetchCoverage(client, 'user-1', query(), NOW);
    expect(items[0]?.personaId).toBeNull();
  });

  it('skips schedule rows with a non-string id', async () => {
    const { client } = fakeClient({
      scheduled_posts: { data: [postRecord()], error: null },
      schedules: { data: [{ id: 123, persona_id: PERSONA }, { id: 'sched-1', persona_id: PERSONA }], error: null },
      post_metrics_done: { data: [], error: null },
      post_metrics: { data: [], error: null },
    });
    const { items } = await fetchCoverage(client, 'user-1', query(), NOW);
    expect(items[0]?.personaId).toBe(PERSONA);
  });

  it('treats a non-string schedule id as no persona', async () => {
    const { client, from } = fakeClient({
      scheduled_posts: { data: [postRecord({ schedule_id: 123 })], error: null },
      schedules: { data: [{ id: 'sched-1', persona_id: PERSONA }], error: null },
      post_metrics_done: { data: [], error: null },
      post_metrics: { data: [], error: null },
    });
    const { items } = await fetchCoverage(client, 'user-1', query(), NOW);
    expect(items[0]?.personaId).toBeNull();
    // No post references a schedule, so the schedules read never runs.
    expect(from).not.toHaveBeenCalledWith('schedules');
  });

  it('treats non-array publish outcomes as no outcomes', async () => {
    const { client } = fakeClient({
      scheduled_posts: { data: [postRecord({ publish_outcomes: 'junk' })], error: null },
      schedules: { data: [{ id: 'sched-1', persona_id: PERSONA }], error: null },
      post_metrics_done: { data: [], error: null },
      post_metrics: { data: [], error: null },
    });
    const { items } = await fetchCoverage(client, 'user-1', query(), NOW);
    expect(items).toEqual([]);
  });

  it('skips posts with a missing id or publish date, and stops when none remain', async () => {
    const { client, from } = fakeClient({
      scheduled_posts: {
        data: [{
          schedule_id: 'sched-1', user_id: 'user-1', status: 'published',
          published_at: '2026-10-21T12:00:00.000Z', publish_outcomes: [YT_OUTCOME],
        }],
        error: null,
      },
      schedules: { data: [{ id: 'sched-1', persona_id: PERSONA }], error: null },
    });
    const { items, truncated } = await fetchCoverage(client, 'user-1', query(), NOW);
    expect(items).toEqual([]);
    expect(truncated).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      '[metrics-coverage] skipped post with missing id or published_at',
      { postId: undefined },
    );
    expect(from).not.toHaveBeenCalledWith('post_metrics_done');
  });

  it('reads a done mark as no-target for a closed window', async () => {
    const { client } = fakeClient({
      scheduled_posts: { data: [postRecord({ published_at: '2026-10-20T12:00:00.000Z' })], error: null },
      schedules: { data: [{ id: 'sched-1', persona_id: PERSONA }], error: null },
      post_metrics_done: { data: [{ post_id: 'post-1' }, { post_id: 123 }], error: null },
      post_metrics: { data: [], error: null },
    });
    const { items } = await fetchCoverage(client, 'user-1', query(), NOW);
    expect(items).toHaveLength(1);
    expect(items[0]?.reason).toBe('no-target');
  });

  it('skips rows with an unknown provider or a missing id, and warns', async () => {
    const { client } = fakeClient({
      scheduled_posts: { data: [postRecord()], error: null },
      schedules: { data: [{ id: 'sched-1', persona_id: PERSONA }], error: null },
      post_metrics_done: { data: [], error: null },
      post_metrics: {
        data: [
          { post_id: 'post-1', provider: 'tiktok', external_id: 't1', script_angle: 'myth' },
          { post_id: 'post-1', provider: 'youtube', external_id: null, script_angle: 'myth' },
          { post_id: 'post-1', provider: 'youtube', external_id: 'abc123', script_angle: 'myth' },
        ],
        error: null,
      },
    });
    const { items } = await fetchCoverage(client, 'user-1', query(), NOW);
    // The valid row collects the YouTube target; nothing is missing.
    expect(items).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      '[metrics-coverage] skipped row with unknown provider or missing id',
      { provider: 'tiktok' },
    );
  });

  it('reads a null script angle from a collected row', async () => {
    const { client } = fakeClient({
      scheduled_posts: { data: [postRecord({ publish_outcomes: [YT_OUTCOME, IG_OUTCOME] })], error: null },
      schedules: { data: [{ id: 'sched-1', persona_id: PERSONA }], error: null },
      post_metrics_done: { data: [], error: null },
      post_metrics: { data: [{ post_id: 'post-1', provider: 'youtube', external_id: 'abc123', script_angle: null }], error: null },
    });
    const { items } = await fetchCoverage(client, 'user-1', query(), NOW);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ provider: 'instagram', scriptAngle: null });
  });

  it('warns when the rows read hits its cap', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      post_id: 'post-1', provider: 'youtube', external_id: `v${i}`, script_angle: 'myth',
    }));
    const { client } = fakeClient({
      scheduled_posts: { data: [postRecord()], error: null },
      schedules: { data: [{ id: 'sched-1', persona_id: PERSONA }], error: null },
      post_metrics_done: { data: [], error: null },
      post_metrics: { data: rows, error: null },
    });
    const { items } = await fetchCoverage(client, 'user-1', query(), NOW);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ provider: 'youtube', externalId: 'abc123', reason: 'retrying' });
    expect(logger.warn).toHaveBeenCalledWith(
      '[metrics-coverage] rows read hit its cap; coverage may overstate missing snapshots',
      { userId: 'user-1', window: '24h' },
    );
  });

  it('warns about unknown providers in publish outcomes', async () => {
    const { client } = fakeClient({
      scheduled_posts: {
        data: [postRecord({ publish_outcomes: [{ provider: 'tiktok', accountId: 'a', status: 'published', postId: 'p' }] })],
        error: null,
      },
      schedules: { data: [{ id: 'sched-1', persona_id: PERSONA }], error: null },
      post_metrics_done: { data: [], error: null },
      post_metrics: { data: [], error: null },
    });
    const { items } = await fetchCoverage(client, 'user-1', query(), NOW);
    expect(items).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      '[metrics-coverage] unknown provider in publish outcomes',
      { provider: 'tiktok' },
    );
  });

  it('flags truncation when more posts than the cap exist', async () => {
    const posts = Array.from({ length: METRICS_ROW_LIMIT + 1 }, (_, i) => postRecord({ id: `post-${i}` }));
    const { client } = fakeClient({
      scheduled_posts: { data: posts, error: null },
      schedules: { data: [{ id: 'sched-1', persona_id: PERSONA }], error: null },
      post_metrics_done: { data: [], error: null },
      post_metrics: { data: [], error: null },
    });
    const { truncated } = await fetchCoverage(client, 'user-1', query(), NOW);
    expect(truncated).toBe(true);
  });
});
