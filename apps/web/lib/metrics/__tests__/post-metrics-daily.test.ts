import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  collectPostMetricsDaily,
  createPostMetricsDailyStore,
  utcSnapshotDate,
  DAILY_RUN_TIME_BUDGET_MS,
  MAX_DAILY_POSTS_PER_RUN,
  type DailyDuePost,
  type DailyReading,
  type PostMetricsDailyDeps,
} from '../post-metrics-daily';
import { metricsTargets, type MetricsTarget } from '../post-metrics';
import { logger } from '@/lib/logger';
import { InstagramApiError } from '@/lib/errors';

const COUNTERS = { views: 1200, likes: 80, comments: 9, saves: null };
const NOW = new Date('2026-11-21T12:00:00.000Z');

function post(id: string, collected: string[] = []): DailyDuePost {
  return { id, userId: 'user-1', taskId: `task-${id}`, collectedKeys: new Set(collected) };
}

const YT_ENTRY = {
  provider: 'youtube',
  status: 'published',
  accountId: 'yt-acct',
  videoUrl: 'https://www.youtube.com/watch?v=abc123',
};
const IG_ENTRY = { provider: 'instagram', status: 'published', accountId: 'ig-acct', postId: 'media-9' };

function deps(overrides: Partial<PostMetricsDailyDeps> = {}): PostMetricsDailyDeps {
  return {
    listDuePosts: vi.fn(async () => [post('post-1')]),
    fetchTaskSource: vi.fn(async () => ({ publishResults: [YT_ENTRY, IG_ENTRY] })),
    fetchCounters: vi.fn(async () => COUNTERS),
    resolveTarget: vi.fn(async (_userId: string, target: MetricsTarget) => target),
    saveReading: vi.fn(async () => undefined),
    markAttempted: vi.fn(async () => undefined),
    metricsTargets,
    now: () => NOW,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('collectPostMetricsDaily', () => {
  it('writes one reading per live video with the UTC snapshot date', async () => {
    const d = deps();
    const report = await collectPostMetricsDaily(d);

    expect(report).toEqual({ checked: 1, recorded: 2, errors: [], truncated: false });
    expect(d.saveReading).toHaveBeenCalledWith({
      postId: 'post-1',
      userId: 'user-1',
      provider: 'youtube',
      externalId: 'abc123',
      snapshotDate: '2026-11-21',
      views: 1200,
      likes: 80,
      comments: 9,
      saves: null,
    });
    expect(d.saveReading).toHaveBeenCalledWith(expect.objectContaining({ provider: 'instagram', externalId: 'media-9' }));
  });

  it('asks the due finder for one more post than the cap to detect truncation', async () => {
    const d = deps({ listDuePosts: vi.fn(async () => []) });
    await collectPostMetricsDaily(d);
    expect(d.listDuePosts).toHaveBeenCalledWith(NOW, MAX_DAILY_POSTS_PER_RUN + 1);
  });

  it('caps the run and reports truncated when more posts are due than the cap', async () => {
    const many = Array.from({ length: MAX_DAILY_POSTS_PER_RUN + 1 }, (_, i) => post(`p${i}`));
    const d = deps({ listDuePosts: vi.fn(async () => many) });
    const report = await collectPostMetricsDaily(d);
    expect(report.truncated).toBe(true);
    expect(report.checked).toBe(MAX_DAILY_POSTS_PER_RUN);
    expect(d.fetchTaskSource).toHaveBeenCalledTimes(MAX_DAILY_POSTS_PER_RUN);
    expect(d.fetchTaskSource).not.toHaveBeenCalledWith(`task-p${MAX_DAILY_POSTS_PER_RUN}`, 'user-1');
  });

  it('is not truncated when exactly the cap is due', async () => {
    const exact = Array.from({ length: MAX_DAILY_POSTS_PER_RUN }, (_, i) => post(`p${i}`));
    const report = await collectPostMetricsDaily(deps({ listDuePosts: vi.fn(async () => exact) }));
    expect(report.truncated).toBe(false);
    expect(report.checked).toBe(MAX_DAILY_POSTS_PER_RUN);
  });

  it('stops at the time budget after the post that used it up and reports truncated', async () => {
    let elapsedMs = 0;
    const d = deps({
      listDuePosts: vi.fn(async () => [post('a'), post('b')]),
      fetchTaskSource: vi.fn(async () => {
        elapsedMs = DAILY_RUN_TIME_BUDGET_MS + 1;
        return { publishResults: [IG_ENTRY] };
      }),
      now: () => new Date(NOW.getTime() + elapsedMs),
    });
    const report = await collectPostMetricsDaily(d);
    expect(report.truncated).toBe(true);
    expect(report.checked).toBe(1);
    expect(d.fetchTaskSource).toHaveBeenCalledTimes(1);
  });

  it('does not stop at exactly the time budget', async () => {
    const d = deps({
      listDuePosts: vi.fn(async () => [post('a'), post('b')]),
      now: () => new Date(NOW.getTime() + DAILY_RUN_TIME_BUDGET_MS),
    });
    const report = await collectPostMetricsDaily(d);
    expect(report.truncated).toBe(false);
    expect(report.checked).toBe(2);
  });

  it('honors a smaller budgetMs than the default', async () => {
    let calls = 0;
    const d = deps({
      budgetMs: 1_000,
      listDuePosts: vi.fn(async () => [post('a')]),
      now: () => {
        calls += 1;
        return new Date(NOW.getTime() + (calls > 1 ? 2_000 : 0));
      },
    });
    const report = await collectPostMetricsDaily(d);
    expect(report.truncated).toBe(true);
    expect(report.checked).toBe(0);
  });

  it('logs a failing provider and keeps reading the other videos', async () => {
    const d = deps({
      fetchCounters: vi.fn(async (_userId: string, target: MetricsTarget) => {
        if (target.provider === 'youtube') throw new Error('quota exceeded');
        return COUNTERS;
      }),
    });
    const report = await collectPostMetricsDaily(d);

    expect(logger.warn).toHaveBeenCalledWith('[post-metrics-daily] reading failed', {
      postId: 'post-1',
      provider: 'youtube',
      error: 'quota exceeded',
      status: undefined,
      metaCode: undefined,
    });
    expect(report.errors).toEqual(['post-1/youtube: reading failed']);
    expect(report.recorded).toBe(1);
    expect(d.saveReading).toHaveBeenCalledTimes(1);
    expect(d.saveReading).toHaveBeenCalledWith(expect.objectContaining({ provider: 'instagram' }));
  });

  it('logs a write failure and continues with the next video', async () => {
    const saveReading = vi.fn(async (reading: DailyReading) => {
      if (reading.provider === 'youtube') throw new Error('daily reading write failed: down');
    });
    const report = await collectPostMetricsDaily(deps({ saveReading }));
    expect(report.recorded).toBe(1);
    expect(report.errors).toEqual(['post-1/youtube: reading failed']);
    expect(logger.warn).toHaveBeenCalledWith(
      '[post-metrics-daily] reading failed',
      expect.objectContaining({ postId: 'post-1', provider: 'youtube', error: 'daily reading write failed: down' }),
    );
  });

  it('skips a deleted video quietly without reporting an error', async () => {
    const gone = new InstagramApiError('Unsupported get request', 400, undefined, 100, 33);
    const d = deps({
      fetchCounters: vi.fn(async (_userId: string, target: MetricsTarget) => {
        if (target.provider === 'instagram') throw gone;
        return COUNTERS;
      }),
    });
    const report = await collectPostMetricsDaily(d);
    expect(report.errors).toEqual([]);
    expect(report.recorded).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[post-metrics-daily] reading skipped',
      expect.objectContaining({ postId: 'post-1', provider: 'instagram', externalId: 'media-9' }),
    );
  });

  it('logs and skips a target the resolver cannot map to an account', async () => {
    const d = deps({ resolveTarget: vi.fn(async () => null) });
    const report = await collectPostMetricsDaily(d);
    expect(report.recorded).toBe(0);
    expect(d.fetchCounters).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('[post-metrics-daily] reading skipped', {
      postId: 'post-1',
      provider: 'youtube',
      externalId: 'abc123',
      accountId: 'yt-acct',
    });
  });

  it('logs unknown providers and still reads the known ones', async () => {
    const d = deps({
      fetchTaskSource: vi.fn(async () => ({
        publishResults: [{ provider: 'myspace', status: 'published', accountId: 'x', postId: 'y' }, IG_ENTRY],
      })),
    });
    const report = await collectPostMetricsDaily(d);
    expect(logger.warn).toHaveBeenCalledWith('[post-metrics-daily] unknown provider in publish results', {
      postId: 'post-1',
      provider: 'myspace',
    });
    expect(report.errors).toEqual(['post-1/myspace: unknown provider']);
    expect(report.recorded).toBe(1);
  });

  it('logs unavailable publish results and moves on to the next post', async () => {
    const fetchTaskSource = vi.fn(async (taskId: string) => {
      if (taskId === 'task-a') throw new Error('engine down');
      return { publishResults: [IG_ENTRY] };
    });
    const d = deps({ fetchTaskSource, listDuePosts: vi.fn(async () => [post('a'), post('b')]) });
    const report = await collectPostMetricsDaily(d);
    expect(logger.warn).toHaveBeenCalledWith('[post-metrics-daily] publish results unavailable', {
      postId: 'a',
      error: 'engine down',
    });
    expect(report.errors).toEqual(['a: publish results unavailable']);
    expect(report.checked).toBe(2);
    expect(report.recorded).toBe(1);
  });

  it('reads a video listed twice in the publish results only once', async () => {
    const d = deps({ fetchTaskSource: vi.fn(async () => ({ publishResults: [IG_ENTRY, IG_ENTRY] })) });
    const report = await collectPostMetricsDaily(d);
    expect(report.recorded).toBe(1);
    expect(d.fetchCounters).toHaveBeenCalledTimes(1);
  });

  it('stores nulls as null, never as zero', async () => {
    const d = deps({
      fetchTaskSource: vi.fn(async () => ({ publishResults: [IG_ENTRY] })),
      fetchCounters: vi.fn(async () => ({ views: null, likes: null, comments: null, saves: null })),
    });
    await collectPostMetricsDaily(d);
    expect(d.saveReading).toHaveBeenCalledWith(
      expect.objectContaining({ views: null, likes: null, comments: null, saves: null }),
    );
  });

  it('writes the same key on a same-day re-run so the upsert overwrites instead of duplicating', async () => {
    const writes: DailyReading[] = [];
    const d = deps({
      fetchTaskSource: vi.fn(async () => ({ publishResults: [IG_ENTRY] })),
      saveReading: vi.fn(async (reading: DailyReading) => {
        writes.push(reading);
      }),
    });
    await collectPostMetricsDaily(d);
    await collectPostMetricsDaily({ ...d, now: () => new Date('2026-11-21T23:59:00.000Z') });
    const keys = writes.map((w) => `${w.postId}:${w.provider}:${w.externalId}:${w.snapshotDate}`);
    expect(keys).toEqual(['post-1:instagram:media-9:2026-11-21', 'post-1:instagram:media-9:2026-11-21']);
  });

  it('dates the reading by the UTC day, not the local day', () => {
    expect(utcSnapshotDate(new Date('2026-11-21T23:59:59.000Z'))).toBe('2026-11-21');
    expect(utcSnapshotDate(new Date('2026-11-22T00:00:00.000Z'))).toBe('2026-11-22');
  });
});

describe('attempt markers', () => {
  const GONE = new InstagramApiError('Unsupported get request', 400, undefined, 100, 33);
  const goneAll = (): Partial<PostMetricsDailyDeps> => ({
    fetchCounters: vi.fn(async () => {
      throw GONE;
    }),
  });

  it('marks the post attempted after a successful reading', async () => {
    const d = deps();
    await collectPostMetricsDaily(d);
    expect(d.markAttempted).toHaveBeenCalledWith('post-1', '2026-11-21');
  });

  it('marks a post whose videos are all gone as attempted without writing any reading', async () => {
    const d = deps(goneAll());
    const report = await collectPostMetricsDaily(d);
    expect(d.saveReading).not.toHaveBeenCalled();
    expect(d.markAttempted).toHaveBeenCalledWith('post-1', '2026-11-21');
    expect(report.errors).toEqual([]);
  });

  it('marks a post attempted when no target resolves to an account', async () => {
    const d = deps({ resolveTarget: vi.fn(async () => null) });
    await collectPostMetricsDaily(d);
    expect(d.saveReading).not.toHaveBeenCalled();
    expect(d.markAttempted).toHaveBeenCalledTimes(1);
  });

  it('marks a post that only has unknown providers as attempted', async () => {
    const d = deps({
      fetchTaskSource: vi.fn(async () => ({
        publishResults: [{ provider: 'myspace', status: 'published', accountId: 'x', postId: 'y' }],
      })),
    });
    await collectPostMetricsDaily(d);
    expect(d.fetchCounters).not.toHaveBeenCalled();
    expect(d.markAttempted).toHaveBeenCalledWith('post-1', '2026-11-21');
  });

  it('marks a mixed post (one video gone, one read) as attempted and keeps the reading', async () => {
    const d = deps({
      fetchCounters: vi.fn(async (_userId: string, target: MetricsTarget) => {
        if (target.provider === 'instagram') throw GONE;
        return COUNTERS;
      }),
    });
    await collectPostMetricsDaily(d);
    expect(d.saveReading).toHaveBeenCalledTimes(1);
    expect(d.saveReading).toHaveBeenCalledWith(expect.objectContaining({ provider: 'youtube' }));
    expect(d.markAttempted).toHaveBeenCalledWith('post-1', '2026-11-21');
  });

  it('marks a dead token as attempted so it is not retried every hour', async () => {
    const dead = new InstagramApiError('Invalid OAuth access token', 400, undefined, 190);
    const d = deps({
      fetchCounters: vi.fn(async () => {
        throw dead;
      }),
    });
    const report = await collectPostMetricsDaily(d);
    expect(report.errors.length).toBe(2);
    expect(d.markAttempted).toHaveBeenCalledTimes(1);
  });

  it('leaves a post unmarked after a transient failure so the next run retries it', async () => {
    const d = deps({
      fetchCounters: vi.fn(async (_userId: string, target: MetricsTarget) => {
        if (target.provider === 'youtube') throw new Error('503 upstream');
        return COUNTERS;
      }),
    });
    await collectPostMetricsDaily(d);
    expect(d.markAttempted).not.toHaveBeenCalled();
  });

  it('leaves a post unmarked when its publish results are unavailable', async () => {
    const d = deps({
      fetchTaskSource: vi.fn(async () => {
        throw new Error('engine down');
      }),
    });
    await collectPostMetricsDaily(d);
    expect(d.markAttempted).not.toHaveBeenCalled();
  });

  it('skips videos already read today and reads only the missing one on a retry', async () => {
    const d = deps({ listDuePosts: vi.fn(async () => [post('post-1', ['youtube:abc123'])]) });
    const report = await collectPostMetricsDaily(d);
    expect(report.recorded).toBe(1);
    expect(d.saveReading).toHaveBeenCalledTimes(1);
    expect(d.saveReading).toHaveBeenCalledWith(expect.objectContaining({ provider: 'instagram' }));
    expect(d.markAttempted).toHaveBeenCalledTimes(1);
  });

  it('logs a failed attempt marker write with the exact call', async () => {
    const d = deps({
      markAttempted: vi.fn(async () => {
        throw new Error('daily attempt write failed: down');
      }),
    });
    const report = await collectPostMetricsDaily(d);
    expect(logger.warn).toHaveBeenCalledWith('[post-metrics-daily] mark attempted failed', {
      postId: 'post-1',
      error: 'daily attempt write failed: down',
    });
    expect(report.errors).toEqual(['post-1: mark attempted failed']);
  });

  it('reads the healthy post on the next run after 50 attempted-but-gone posts filled the cap', async () => {
    const attempted = new Set<string>();
    const pool = [
      ...Array.from({ length: MAX_DAILY_POSTS_PER_RUN }, (_, i) => `gone-${i}`),
      'healthy',
    ];
    const readPosts: string[] = [];

    const first = await collectPostMetricsDaily(
      deps({
        listDuePosts: vi.fn(async (_now: Date, limit: number) =>
          pool.filter((id) => !attempted.has(id)).slice(0, limit).map((id) => post(id)),
        ),
        fetchTaskSource: vi.fn(async () => ({ publishResults: [IG_ENTRY] })),
        fetchCounters: vi.fn(async () => {
          throw GONE;
        }),
        markAttempted: vi.fn(async (postId: string) => {
          attempted.add(postId);
        }),
      }),
    );
    expect(first.truncated).toBe(true);
    expect(attempted.size).toBe(MAX_DAILY_POSTS_PER_RUN);

    const second = await collectPostMetricsDaily(
      deps({
        listDuePosts: vi.fn(async (_now: Date, limit: number) =>
          pool.filter((id) => !attempted.has(id)).slice(0, limit).map((id) => post(id)),
        ),
        fetchTaskSource: vi.fn(async () => ({ publishResults: [IG_ENTRY] })),
        markAttempted: vi.fn(async (postId: string) => {
          attempted.add(postId);
        }),
        saveReading: vi.fn(async (reading: DailyReading) => {
          readPosts.push(reading.postId);
        }),
      }),
    );
    expect(second.truncated).toBe(false);
    expect(readPosts).toEqual(['healthy']);
  });
});

describe('createPostMetricsDailyStore', () => {
  it('lists due posts through the definer function and drops malformed rows', async () => {
    const rpc = vi.fn(async () => ({
      data: [
        { post_id: 'p1', user_id: 'u1', task_id: 't1', published_at: '2026-11-20T10:00:00Z', collected_keys: ['youtube:abc', 7] },
        { post_id: 'p2', user_id: 'u1', task_id: null, published_at: null },
        { post_id: 5, user_id: 'u1', task_id: 't3', published_at: null },
      ],
      error: null,
    }));
    const store = createPostMetricsDailyStore({ rpc } as unknown as SupabaseClient);
    const posts = await store.listDuePosts(NOW, 51);
    expect(rpc).toHaveBeenCalledWith('find_post_metrics_daily_due', { p_now: NOW.toISOString(), p_limit: 51 });
    expect(posts).toEqual([{ id: 'p1', userId: 'u1', taskId: 't1', collectedKeys: new Set(['youtube:abc']) }]);
  });

  it('throws when the due lookup fails', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'boom' } }));
    const store = createPostMetricsDailyStore({ rpc } as unknown as SupabaseClient);
    await expect(store.listDuePosts(NOW, 51)).rejects.toThrow('daily due posts lookup failed: boom');
  });

  it('upserts on the unique key with every column and refreshes collected_at', async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({ upsert }));
    const store = createPostMetricsDailyStore({ from } as unknown as SupabaseClient);
    await store.saveReading({
      postId: 'p1',
      userId: 'u1',
      provider: 'youtube',
      externalId: 'abc',
      snapshotDate: '2026-11-21',
      views: 10,
      likes: null,
      comments: 0,
      saves: null,
    });
    expect(from).toHaveBeenCalledWith('post_metrics_daily');
    expect(upsert).toHaveBeenCalledWith(
      {
        post_id: 'p1',
        user_id: 'u1',
        provider: 'youtube',
        external_id: 'abc',
        snapshot_date: '2026-11-21',
        views: 10,
        likes: null,
        comments: 0,
        saves: null,
        collected_at: expect.any(String),
      },
      { onConflict: 'post_id,provider,external_id,snapshot_date' },
    );
  });

  it('throws when the write fails', async () => {
    const from = vi.fn(() => ({ upsert: vi.fn(async () => ({ error: { message: 'nope' } })) }));
    const store = createPostMetricsDailyStore({ from } as unknown as SupabaseClient);
    await expect(
      store.saveReading({
        postId: 'p1',
        userId: 'u1',
        provider: 'youtube',
        externalId: 'abc',
        snapshotDate: '2026-11-21',
        views: null,
        likes: null,
        comments: null,
        saves: null,
      }),
    ).rejects.toThrow('daily reading write failed: nope');
  });

  it('upserts the attempt marker on its primary key', async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({ upsert }));
    const store = createPostMetricsDailyStore({ from } as unknown as SupabaseClient);
    await store.markAttempted('p1', '2026-11-21');
    expect(from).toHaveBeenCalledWith('post_metrics_daily_attempts');
    expect(upsert).toHaveBeenCalledWith(
      { post_id: 'p1', snapshot_date: '2026-11-21', attempted_at: expect.any(String) },
      { onConflict: 'post_id,snapshot_date' },
    );
  });

  it('throws when the attempt marker write fails', async () => {
    const from = vi.fn(() => ({ upsert: vi.fn(async () => ({ error: { message: 'nope' } })) }));
    const store = createPostMetricsDailyStore({ from } as unknown as SupabaseClient);
    await expect(store.markAttempted('p1', '2026-11-21')).rejects.toThrow('daily attempt write failed: nope');
  });
});
