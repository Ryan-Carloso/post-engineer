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

const COUNTERS = { views: 1200, likes: 80, comments: 9, saves: null };

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
    fetchPublishResults: vi.fn(async () => [YT_ENTRY, IG_ENTRY]),
    fetchCounters: vi.fn(async () => COUNTERS),
    saveMetrics: vi.fn(async () => undefined),
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

describe('metricsTargets', () => {
  it('maps published YouTube and Instagram entries to their video ids and accounts', () => {
    expect(metricsTargets([YT_ENTRY, IG_ENTRY])).toEqual([
      { provider: 'youtube', accountId: 'yt-acct', externalId: 'abc123' },
      { provider: 'instagram', accountId: 'ig-acct', externalId: 'media-9' },
    ]);
  });

  it('skips failed entries, entries without an account, and unmeasured providers', () => {
    expect(
      metricsTargets([
        { ...YT_ENTRY, status: 'failed' },
        { ...IG_ENTRY, accountId: undefined },
        { provider: 'bluesky', status: 'published', accountId: 'did', postId: 'at://x' },
        null,
      ]),
    ).toEqual([]);
  });
});

describe('collectPostMetrics', () => {
  it('snapshots every published video of a due post and tracks it with the task id', async () => {
    const d = deps();
    const report = await collectPostMetrics(d);

    expect(report).toEqual({ checked: 1, recorded: 2, errors: [], truncated: false });
    expect(d.listDuePosts).toHaveBeenCalledWith(new Date('2026-10-21T12:00:00.000Z'), MAX_POSTS_PER_RUN + 1);
    expect(d.fetchPublishResults).toHaveBeenCalledWith('task-1', 'user-1');
    expect(d.saveMetrics).toHaveBeenCalledWith({
      postId: 'post-1',
      userId: 'user-1',
      window: '24h',
      provider: 'youtube',
      accountId: 'yt-acct',
      externalId: 'abc123',
      ...COUNTERS,
    });
    expect(d.track).toHaveBeenCalledWith('post_metrics_collected', {
      task_id: 'task-1',
      post_id: 'post-1',
      user_id: 'user-1',
      provider: 'instagram',
      window: '24h',
      ...COUNTERS,
    });
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
    });
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
    const fetchPublishResults = vi
      .fn()
      .mockRejectedValueOnce(new Error('engine down'))
      .mockResolvedValueOnce([YT_ENTRY]);
    const d = deps({
      listDuePosts: vi.fn(async () => [duePost(), duePost({ id: 'post-2', taskId: 'task-2' })]),
      fetchPublishResults,
    });
    const report = await collectPostMetrics(d);

    expect(report.checked).toBe(2);
    expect(report.recorded).toBe(1);
    expect(report.errors).toEqual(['post-1: publish results unavailable']);
  });

  it('caps the run at MAX_POSTS_PER_RUN and flags truncation', async () => {
    const posts = Array.from({ length: MAX_POSTS_PER_RUN + 1 }, (_, i) => duePost({ id: `post-${i}` }));
    const d = deps({ listDuePosts: vi.fn(async () => posts), fetchPublishResults: vi.fn(async () => []) });
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
    ]);
  });

  it('throws when the due-posts RPC returns an error', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'boom' } }));
    const store = createPostMetricsStore({ rpc } as unknown as SupabaseClient);
    await expect(store.listDuePosts(new Date(), 51)).rejects.toThrow('due posts lookup failed: boom');
  });

  it('upserts one row per post/video/window and throws on a write error', async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({ upsert }));
    const store = createPostMetricsStore({ from } as unknown as SupabaseClient);
    await store.saveMetrics({
      postId: 'post-1',
      userId: 'user-1',
      provider: 'youtube',
      accountId: 'yt-acct',
      externalId: 'abc123',
      window: '7d',
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
      },
      { onConflict: 'post_id,provider,external_id,metrics_window' },
    );

    upsert.mockResolvedValueOnce({ error: { message: 'denied' } } as never);
    await expect(
      store.saveMetrics({
        postId: 'post-1', userId: 'user-1', provider: 'youtube', accountId: 'a', externalId: 'b', window: '7d', ...COUNTERS,
      }),
    ).rejects.toThrow('metrics write failed: denied');
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
    // The upsert's onConflict target must be the table's unique key.
    expect(sql).toContain('unique (post_id, provider, external_id, metrics_window)');
  });
});
