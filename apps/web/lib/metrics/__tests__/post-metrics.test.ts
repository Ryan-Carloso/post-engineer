import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findRepoRoot } from '@/test/repo-root';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  collectPostMetrics,
  createPostMetricsStore,
  metricsTargets,
  youtubeVideoId,
  MAX_POSTS_PER_RUN,
  RUN_TIME_BUDGET_MS,
  type DuePost,
  type PostMetricsDeps,
} from '../post-metrics';
import { logger } from '@/lib/logger';
import { SOCIAL_PROVIDERS } from '@/lib/providers/registry';
import { ANALYTICS_STATUSES } from '../metrics-query';

const COUNTERS = { views: 1200, likes: 80, comments: 9, saves: null };
const NO_EXPERIMENT = { experimentId: null, variantId: null, experimentPair: null };

function duePost(overrides: Partial<DuePost> = {}): DuePost {
  return {
    id: 'post-1',
    userId: 'user-1',
    taskId: 'task-1',
    window: '24h',
    collectedKeys: new Set(),
    ...overrides,
  };
}

const YT_ENTRY = {
  provider: 'youtube',
  status: 'published',
  accountId: 'yt-acct',
  videoUrl: 'https://www.youtube.com/watch?v=abc123',
};
const IG_ENTRY = { provider: 'instagram', status: 'published', accountId: 'ig-acct', postId: 'media-9' };

function deps(overrides: Partial<PostMetricsDeps> = {}): PostMetricsDeps {
  return {
    listDuePosts: vi.fn(async () => [duePost()]),
    fetchTaskSource: vi.fn(async () => ({ publishResults: [YT_ENTRY, IG_ENTRY], scriptAngle: 'myth' })),
    fetchCounters: vi.fn(async () => COUNTERS),
    saveMetrics: vi.fn(async () => NO_EXPERIMENT),
    markDone: vi.fn(async () => undefined),
    track: vi.fn(),
    now: () => new Date('2026-10-21T12:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('youtubeVideoId', () => {
  it('reads watch, short-link and shorts URLs', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=abc123')).toBe('abc123');
    expect(youtubeVideoId('https://youtu.be/abc123')).toBe('abc123');
    expect(youtubeVideoId('https://m.youtube.com/shorts/abc123')).toBe('abc123');
  });

  it('returns null for non-YouTube or malformed links', () => {
    expect(youtubeVideoId('https://evil.example/watch?v=abc123')).toBeNull();
    expect(youtubeVideoId('not a url')).toBeNull();
    expect(youtubeVideoId('https://www.youtube.com/channel/x')).toBeNull();
  });
});

const BSKY_ENTRY = { provider: 'bluesky', status: 'published', accountId: 'did:plc:x', postId: 'at://did:plc:x/app.bsky.feed.post/r1' };
const LI_ENTRY = { provider: 'linkedin', status: 'published', accountId: 'li-acct', postId: 'urn:li:share:42' };

describe('metricsTargets', () => {
  it('maps published entries of every provider to their video ids and accounts', () => {
    expect(metricsTargets([YT_ENTRY, IG_ENTRY, BSKY_ENTRY, LI_ENTRY]).targets).toEqual([
      { provider: 'youtube', accountId: 'yt-acct', externalId: 'abc123' },
      { provider: 'instagram', accountId: 'ig-acct', externalId: 'media-9' },
      { provider: 'bluesky', accountId: 'did:plc:x', externalId: 'at://did:plc:x/app.bsky.feed.post/r1' },
      { provider: 'linkedin', accountId: 'li-acct', externalId: 'urn:li:share:42' },
    ]);
  });

  it('extracts a target for every provider in SOCIAL_PROVIDERS', () => {
    const fixtures: Record<string, unknown> = { youtube: YT_ENTRY, instagram: IG_ENTRY, bluesky: BSKY_ENTRY, linkedin: LI_ENTRY, threads: { provider: 'threads', status: 'published', accountId: '42', postId: 'p1' }, facebook: { provider: 'facebook', status: 'published', accountId: '111', postId: 'v1' }, pinterest: { provider: 'pinterest', status: 'published', accountId: 'pin-acct', postId: '1234567890123456' }, rumble: { provider: 'rumble', status: 'published', accountId: 'chan-1', postId: 'vid-1' } };
    for (const provider of SOCIAL_PROVIDERS) {
      const { targets } = metricsTargets([fixtures[provider]]);
      expect(targets.map((target) => target.provider), provider).toEqual([provider]);
    }
  });

  it('skips failed entries and entries without an account', () => {
    expect(
      metricsTargets([{ ...YT_ENTRY, status: 'failed' }, { ...IG_ENTRY, accountId: undefined }, null]),
    ).toEqual({ targets: [], unknownProviders: [] });
  });

  it('reports providers it does not know instead of dropping them', () => {
    expect(metricsTargets([{ provider: 'tiktok', status: 'published', accountId: 'a', postId: 'p' }])).toEqual({
      targets: [],
      unknownProviders: ['tiktok'],
    });
  });
});

// Each migration that re-creates the check must list every provider the
// app supported at that point; the latest one (050) lists them all.
// A shipped migration is never edited, so 049 pins its historical list.
// app supported at that point; the latest one (052) lists them all.
describe('post_metrics provider check (migrations 034, 049, 050 and 052)', () => {
  function listedProviders(file: string): string[] {
    const sql = readFileSync(join(findRepoRoot(import.meta.url), 'supabase/migrations', file), 'utf8');
    const line = sql.split('\n').find((candidate) => candidate.includes('check (provider in'));
    return (line ?? '').split("'").filter((_, index) => index % 2 === 1);
  }

  it('034 allows the five providers supported when it shipped', () => {
    expect(listedProviders('034_threads-provider.sql').sort()).toEqual(['bluesky', 'instagram', 'linkedin', 'threads', 'youtube']);
  });

  it('049 allows the six providers supported when it shipped', () => {
    expect(listedProviders('049_facebook-provider.sql').sort()).toEqual(['bluesky', 'facebook', 'instagram', 'linkedin', 'threads', 'youtube']);
  });

  it('050 allows the seven providers supported when it shipped', () => {
    expect(listedProviders('050_pinterest-provider.sql').sort()).toEqual([
      'bluesky',
      'facebook',
      'instagram',
      'linkedin',
      'pinterest',
      'threads',
      'youtube',
    ]);
  });

  it('052 allows exactly the providers in SOCIAL_PROVIDERS', () => {
    expect(listedProviders('052_rumble-provider.sql').sort()).toEqual([...SOCIAL_PROVIDERS].sort());
  });
});

describe('collectPostMetrics', () => {
  it('snapshots every published video of a due post and tracks it with the task id', async () => {
    const d = deps();
    const report = await collectPostMetrics(d);

    expect(report).toEqual({ checked: 1, recorded: 2, errors: [], truncated: false });
    expect(d.listDuePosts).toHaveBeenCalledWith(new Date('2026-10-21T12:00:00.000Z'), MAX_POSTS_PER_RUN + 1);
    expect(d.fetchTaskSource).toHaveBeenCalledWith('task-1', 'user-1');
    expect(d.saveMetrics).toHaveBeenCalledWith({
      postId: 'post-1',
      userId: 'user-1',
      window: '24h',
      provider: 'youtube',
      accountId: 'yt-acct',
      externalId: 'abc123',
      scriptAngle: 'myth',
      ...COUNTERS,
    });
    expect(d.track).toHaveBeenCalledWith('post_metrics_collected', {
      task_id: 'task-1',
      post_id: 'post-1',
      script_angle: 'myth',
      user_id: 'user-1',
      provider: 'instagram',
      window: '24h',
      ...COUNTERS,
      engaged_views: null,
      analytics_status: null,
      experiment_id: null,
      variant_id: null,
      experiment_pair: null,
    });
  });

  it('tags the event with the experiment link the snapshot carries (issue #476)', async () => {
    const d = deps({
      saveMetrics: vi.fn(async () => ({ experimentId: 'exp-1', variantId: 'hook-aggressive', experimentPair: 2 })),
    });
    await collectPostMetrics(d);
    expect(d.track).toHaveBeenCalledWith('post_metrics_collected', expect.objectContaining({
      experiment_id: 'exp-1', variant_id: 'hook-aggressive', experiment_pair: 2,
    }));
  });

  it('passes the window and clock to the fetcher and tracks only retention counts and status', async () => {
    const retention = {
      status: 'ok' as const, analyticsViews: 1000, engagedViews: 640, averageViewDurationSeconds: 21.4,
      averageViewPercentage: 78.2, contentType: 'SHORTS', startDate: '2026-10-20', endDate: '2026-10-21',
    };
    const d = deps({
      listDuePosts: vi.fn(async () => [duePost({ window: '28d' })]),
      fetchCounters: vi.fn(async () => ({ ...COUNTERS, retention })),
    });
    await collectPostMetrics(d);

    expect(d.fetchCounters).toHaveBeenCalledWith('user-1', expect.objectContaining({ provider: 'youtube' }), {
      window: '28d',
      now: new Date('2026-10-21T12:00:00.000Z'),
    });
    expect(d.saveMetrics).toHaveBeenCalledWith(expect.objectContaining({ window: '28d', retention }));
    const tracked = vi.mocked(d.track).mock.calls[0]?.[1];
    expect(tracked).toMatchObject({ engaged_views: 640, analytics_status: 'ok', window: '28d' });
    // The nested snapshot (dates, content type) never reaches PostHog.
    expect(tracked).not.toHaveProperty('retention');
  });

  it('reports an unknown provider as an error and still snapshots the known ones', async () => {
    const d = deps({ fetchTaskSource: vi.fn(async () => ({ publishResults: [YT_ENTRY, { provider: 'tiktok', status: 'published', accountId: 'a', postId: 'p' }], scriptAngle: null })) });
    const report = await collectPostMetrics(d);

    expect(report.recorded).toBe(1);
    expect(report.errors).toEqual(['post-1/tiktok: unknown provider']);
    expect(logger.warn).toHaveBeenCalledWith('[post-metrics] unknown provider in publish results', { postId: 'post-1', provider: 'tiktok' });
  });

  it('marks the post done for the window once every video is in', async () => {
    const d = deps();
    await collectPostMetrics(d);
    expect(d.markDone).toHaveBeenCalledWith('post-1', '24h');
  });

  it('keeps the post open when the Analytics scope is missing, so a reconnect backfills it', async () => {
    const scopeMissing = {
      status: 'scope_missing' as const,
      analyticsViews: null,
      engagedViews: null,
      averageViewDurationSeconds: null,
      averageViewPercentage: null,
      contentType: null,
      startDate: null,
      endDate: null,
    };
    const d = deps({ fetchCounters: vi.fn(async () => ({ ...COUNTERS, retention: scopeMissing })) });
    await collectPostMetrics(d);

    expect(d.saveMetrics).toHaveBeenCalledWith(expect.objectContaining({ retention: scopeMissing }));
    expect(d.markDone).not.toHaveBeenCalled();
  });

  it('marks a post with nothing to measure done so it stops coming back', async () => {
    const d = deps({ fetchTaskSource: vi.fn(async () => ({ publishResults: [], scriptAngle: null })) });
    const report = await collectPostMetrics(d);
    expect(report.recorded).toBe(0);
    expect(d.markDone).toHaveBeenCalledWith('post-1', '24h');
  });

  it('keeps the post open when a video fails', async () => {
    const d = deps({ fetchCounters: vi.fn().mockRejectedValueOnce(new Error('403')).mockResolvedValueOnce(COUNTERS) });
    await collectPostMetrics(d);
    expect(d.saveMetrics).toHaveBeenCalledTimes(1);
    expect(d.markDone).not.toHaveBeenCalled();
  });

  it('keeps the post open when publish results are unavailable', async () => {
    const d = deps({ fetchTaskSource: vi.fn(async () => { throw new Error('engine down'); }) });
    await collectPostMetrics(d);
    expect(d.markDone).not.toHaveBeenCalled();
  });

  it('reports a failed mark-done and still finishes the run', async () => {
    const d = deps({
      listDuePosts: vi.fn(async () => [duePost(), duePost({ id: 'post-2' })]),
      markDone: vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(undefined),
    });
    const report = await collectPostMetrics(d);
    expect(report.checked).toBe(2);
    expect(report.errors).toEqual(['post-1: mark done failed']);
    expect(d.markDone).toHaveBeenLastCalledWith('post-2', '24h');
  });

  it('only retries the videos not yet collected for the window', async () => {
    const d = deps({ listDuePosts: vi.fn(async () => [duePost({ collectedKeys: new Set(['youtube:abc123']) })]) });
    const report = await collectPostMetrics(d);

    expect(report.recorded).toBe(1);
    expect(d.fetchCounters).toHaveBeenCalledTimes(1);
    expect(d.fetchCounters).toHaveBeenCalledWith('user-1', {
      provider: 'instagram',
      accountId: 'ig-acct',
      externalId: 'media-9',
    }, { window: '24h', now: new Date('2026-10-21T12:00:00.000Z') });
  });

  it('keeps going after one video fails and reports the failure', async () => {
    const fetchCounters = vi
      .fn()
      .mockRejectedValueOnce(new Error('token expired'))
      .mockResolvedValueOnce(COUNTERS);
    const d = deps({ fetchCounters });
    const report = await collectPostMetrics(d);

    expect(report.recorded).toBe(1);
    expect(report.errors).toEqual(['post-1/youtube: snapshot failed']);
    expect(logger.warn).toHaveBeenCalledWith('[post-metrics] snapshot failed', {
      postId: 'post-1',
      provider: 'youtube',
      error: 'token expired',
    });
    expect(d.track).toHaveBeenCalledTimes(1);
  });

  it('reports an unreachable engine per post without stopping the run', async () => {
    const fetchTaskSource = vi
      .fn()
      .mockRejectedValueOnce(new Error('engine down'))
      .mockResolvedValueOnce({ publishResults: [YT_ENTRY], scriptAngle: null });
    const d = deps({
      listDuePosts: vi.fn(async () => [duePost(), duePost({ id: 'post-2', taskId: 'task-2' })]),
      fetchTaskSource,
    });
    const report = await collectPostMetrics(d);

    expect(report.checked).toBe(2);
    expect(report.recorded).toBe(1);
    expect(report.errors).toEqual(['post-1: publish results unavailable']);
  });

  it('caps the run at MAX_POSTS_PER_RUN and flags truncation', async () => {
    const posts = Array.from({ length: MAX_POSTS_PER_RUN + 1 }, (_, i) => duePost({ id: `post-${i}` }));
    const d = deps({ listDuePosts: vi.fn(async () => posts), fetchTaskSource: vi.fn(async () => ({ publishResults: [], scriptAngle: null })) });
    const report = await collectPostMetrics(d);

    expect(report.checked).toBe(MAX_POSTS_PER_RUN);
    expect(report.truncated).toBe(true);
  });

  it('stops when the time budget is spent and flags truncation', async () => {
    const start = new Date('2026-10-21T12:00:00.000Z').getTime();
    const times = [start, start, start + RUN_TIME_BUDGET_MS + 1];
    const d = deps({
      listDuePosts: vi.fn(async () => [duePost(), duePost({ id: 'post-2' })]),
      now: () => new Date(times.shift() ?? start + RUN_TIME_BUDGET_MS + 1),
    });
    const report = await collectPostMetrics(d);

    expect(report.checked).toBe(1);
    expect(report.truncated).toBe(true);
  });
});

describe('createPostMetricsStore', () => {
  it('reads due posts through find_post_metrics_due and maps collected keys', async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          post_id: 'post-1',
          user_id: 'user-1',
          task_id: 'task-1',
          published_at: '2026-10-20T10:00:00.000Z',
          metrics_window: '24h',
          collected_keys: ['youtube:abc123'],
        },
        { post_id: 'post-2', user_id: 'user-1', task_id: 'task-2', metrics_window: '28d', collected_keys: [] },
        { post_id: 'bad', user_id: 'user-1', task_id: 'task-x', metrics_window: '30d', collected_keys: [] },
      ],
      error: null,
    }));
    const store = createPostMetricsStore({ rpc } as unknown as SupabaseClient);
    const posts = await store.listDuePosts(new Date('2026-10-21T12:00:00.000Z'), 51);

    expect(rpc).toHaveBeenCalledWith('find_post_metrics_due', {
      p_now: '2026-10-21T12:00:00.000Z',
      p_limit: 51,
    });
    expect(posts).toEqual([
      { id: 'post-1', userId: 'user-1', taskId: 'task-1', window: '24h', collectedKeys: new Set(['youtube:abc123']) },
      { id: 'post-2', userId: 'user-1', taskId: 'task-2', window: '28d', collectedKeys: new Set() },
    ]);
  });

  it('throws when the due-posts RPC returns an error', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'boom' } }));
    const store = createPostMetricsStore({ rpc } as unknown as SupabaseClient);
    await expect(store.listDuePosts(new Date(), 51)).rejects.toThrow('due posts lookup failed: boom');
  });

  it('upserts one row per post/video/window, returns its experiment link and throws on a write error', async () => {
    const single = vi.fn(async () => ({ data: { experiment_id: 'exp-1', variant_id: 'hook-calm', experiment_pair: 1 }, error: null }));
    const select = vi.fn(() => ({ single }));
    const upsert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ upsert }));
    const store = createPostMetricsStore({ from } as unknown as SupabaseClient);
    const tag = await store.saveMetrics({
      postId: 'post-1',
      userId: 'user-1',
      provider: 'youtube',
      accountId: 'yt-acct',
      externalId: 'abc123',
      window: '7d',
      scriptAngle: 'myth',
      ...COUNTERS,
    });

    expect(from).toHaveBeenCalledWith('post_metrics');
    expect(upsert).toHaveBeenCalledWith(
      {
        post_id: 'post-1',
        user_id: 'user-1',
        provider: 'youtube',
        account_id: 'yt-acct',
        external_id: 'abc123',
        metrics_window: '7d',
        views: 1200,
        likes: 80,
        comments: 9,
        saves: null,
        script_angle: 'myth',
        analytics_status: null,
        analytics_views: null,
        engaged_views: null,
        average_view_duration_seconds: null,
        average_view_percentage: null,
        content_type: null,
        analytics_start_date: null,
        analytics_end_date: null,
      },
      { onConflict: 'post_id,provider,external_id,metrics_window' },
    );
    expect(select).toHaveBeenCalledWith('experiment_id, variant_id, experiment_pair');
    expect(tag).toEqual({ experimentId: 'exp-1', variantId: 'hook-calm', experimentPair: 1 });

    single.mockResolvedValueOnce({ data: null, error: { message: 'denied' } } as never);
    await expect(
      store.saveMetrics({
        postId: 'post-1', userId: 'user-1', provider: 'youtube', accountId: 'a', externalId: 'b', window: '7d', scriptAngle: null, ...COUNTERS,
      }),
    ).rejects.toThrow('metrics write failed: denied');
  });

  it('marks a post done in post_metrics_done and throws on a write error', async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({ upsert }));
    const store = createPostMetricsStore({ from } as unknown as SupabaseClient);
    await store.markDone('post-1', '7d');

    expect(from).toHaveBeenCalledWith('post_metrics_done');
    expect(upsert).toHaveBeenCalledWith(
      { post_id: 'post-1', metrics_window: '7d' },
      { onConflict: 'post_id,metrics_window' },
    );

    upsert.mockResolvedValueOnce({ error: { message: 'denied' } } as never);
    await expect(store.markDone('post-1', '7d')).rejects.toThrow('mark done failed: denied');
  });

  it('find_post_metrics_due skips posts already in post_metrics_done (SQL sync)', () => {
    const sql = readFileSync(join(findRepoRoot(import.meta.url), 'supabase', 'migrations', '025_post-metrics.sql'), 'utf8');
    expect(sql.includes('create table if not exists public.post_metrics_done')).toBe(true);
    const fn = sql.slice(sql.indexOf('create or replace function public.find_post_metrics_due'));
    const due = fn.slice(0, fn.indexOf('select\n    d.id'));
    expect(due.includes('not exists')).toBe(true);
    expect(due.includes('from public.post_metrics_done pmd')).toBe(true);
  });

  it('writes only columns that exist on public.post_metrics (schema sync)', () => {
    const sql = readFileSync(
      join(findRepoRoot(import.meta.url), 'supabase', 'migrations', '025_post-metrics.sql'),
      'utf8',
    );
    const table = sql.match(/create table if not exists public\.post_metrics \(([\s\S]*?)\n\);/i);
    expect(table).not.toBeNull();
    const columns = new Set((table?.[1] ?? '').split('\n').map((line) => line.trim().split(/\s+/)[0]));
    for (const key of [
      'post_id', 'user_id', 'provider', 'account_id', 'external_id', 'metrics_window', 'views', 'likes', 'comments', 'saves',
    ]) {
      expect(columns.has(key)).toBe(true);
    }
    // The upsert also writes script_angle, added by migration 026 (the
    // final schema is 025 + 026); persona_id is trigger-filled from 026.
    const sql026 = readFileSync(
      join(findRepoRoot(import.meta.url), 'supabase', 'migrations', '026_post-metrics-dimensions.sql'),
      'utf8',
    );
    expect(sql026).toContain('add column if not exists script_angle');
    expect(sql026).toContain('add column if not exists persona_id');
    // The upsert's onConflict target must be the table's unique key.
    expect(sql).toContain('unique (post_id, provider, external_id, metrics_window)');
  });
});

describe('migration 026 (post metrics dimensions)', () => {
  const sql = readFileSync(join(findRepoRoot(import.meta.url), 'supabase', 'migrations', '026_post-metrics-dimensions.sql'), 'utf8');

  it('adds the persona_id and script_angle columns the web reads and writes', () => {
    expect(sql.includes('add column if not exists persona_id uuid')).toBe(true);
    expect(sql.includes('add column if not exists script_angle text')).toBe(true);
  });

  it('fills persona_id on insert from the post schedule', () => {
    expect(sql.includes('before insert on public.post_metrics')).toBe(true);
    expect(sql.includes('join public.schedules s on s.id = sp.schedule_id')).toBe(true);
  });

  it('backfills persona_id for snapshots written before the trigger existed', () => {
    expect(sql.includes('update public.post_metrics pm')).toBe(true);
    expect(sql.includes('set persona_id = s.persona_id')).toBe(true);
    expect(sql.includes('where pm.post_id = sp.id and pm.persona_id is null')).toBe(true);
  });
});

describe('migration 039 (post metrics retention + 28d window)', () => {
  const sql = readFileSync(join(findRepoRoot(import.meta.url), 'supabase', 'migrations', '039_post-metrics-retention.sql'), 'utf8');

  it('adds every retention column saveMetrics writes', async () => {
    const single = vi.fn(async () => ({ data: { experiment_id: null, variant_id: null, experiment_pair: null }, error: null }));
    const upsert = vi.fn((_row: unknown, _options: unknown) => ({ select: () => ({ single }) }));
    const store = createPostMetricsStore({ from: vi.fn(() => ({ upsert })) } as unknown as SupabaseClient);
    await store.saveMetrics({
      postId: 'p', userId: 'u', provider: 'youtube', accountId: 'a', externalId: 'v', window: '28d', scriptAngle: null,
      ...COUNTERS,
      retention: {
        status: 'ok', analyticsViews: 1000, engagedViews: 640, averageViewDurationSeconds: 21.4,
        averageViewPercentage: 78.2, contentType: 'SHORTS', startDate: '2026-10-01', endDate: '2026-10-26',
      },
    });
    const written: unknown = upsert.mock.calls[0]?.[0];
    expect(written).toMatchObject({
      metrics_window: '28d',
      analytics_status: 'ok',
      analytics_views: 1000,
      engaged_views: 640,
      average_view_duration_seconds: 21.4,
      average_view_percentage: 78.2,
      content_type: 'SHORTS',
      analytics_start_date: '2026-10-01',
      analytics_end_date: '2026-10-26',
    });
    const retentionKeys = Object.keys(typeof written === 'object' && written !== null ? written : {})
      .filter((key) => key.startsWith('analytics_') || ['engaged_views', 'average_view_duration_seconds', 'average_view_percentage', 'content_type'].includes(key));
    expect(retentionKeys).toHaveLength(8);
    for (const key of retentionKeys) {
      expect(sql.includes(`add column if not exists ${key} `)).toBe(true);
    }
  });

  it('pins the analytics_status values to the AnalyticsStatus union', () => {
    const quoted = ANALYTICS_STATUSES.map((status) => `'${status}'`).join(', ');
    expect(sql).toContain(`check (analytics_status in (${quoted}))`);
  });

  it('opens the 28d window on both window checks and in find_post_metrics_due', () => {
    expect(sql).toContain("alter table public.post_metrics\n  add constraint post_metrics_metrics_window_check\n  check (metrics_window in ('24h', '7d', '28d'))");
    expect(sql).toContain("alter table public.post_metrics_done\n  add constraint post_metrics_done_metrics_window_check\n  check (metrics_window in ('24h', '7d', '28d'))");
    const fn = sql.slice(sql.indexOf('create or replace function public.find_post_metrics_due'));
    expect(fn).toContain("values ('24h', 24), ('7d', 168), ('28d', 672)");
    expect(fn).toContain('from public.post_metrics_done pmd');
    // A scope-less YouTube snapshot stays uncollected so the next run retries it.
    expect(fn).toContain("and (pm.analytics_status is null or pm.analytics_status = 'scope_missing')");
    expect(fn).toContain('grant execute on function public.find_post_metrics_due(timestamptz, integer) to service_role');
  });

  it('defines the reconnect reset for snapshots without an Analytics scope', () => {
    const fn = sql.slice(sql.indexOf('create or replace function public.reset_post_metrics_windows'));
    expect(fn).toContain('delete from public.post_metrics_done pmd');
    expect(fn).toContain('and pmd.metrics_window = pm.metrics_window');
    expect(fn).toContain("and pm.provider = 'youtube'");
    expect(fn).toContain('and pm.account_id = p_account_id');
    expect(fn).toContain("and (pm.analytics_status is null or pm.analytics_status = 'scope_missing')");
    // A closed window cannot be back-filled: stop the reconnect prompt.
    expect(fn).toContain('update public.post_metrics pm');
    expect(fn).toContain("set analytics_status = 'no_data'");
    expect(fn).toContain("and pm.analytics_status = 'scope_missing'");
    expect(fn).toContain('and not exists (');
    expect(fn).toContain("join (values ('24h', 24), ('7d', 168), ('28d', 672)) w(metrics_window, start_hours)");
    expect(sql).toContain('grant execute on function public.reset_post_metrics_windows(uuid, text) to service_role');
  });
});
