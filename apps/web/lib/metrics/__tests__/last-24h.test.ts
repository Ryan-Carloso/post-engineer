import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { METRICS_NONE, METRICS_ROW_LIMIT, type Last24hQuery } from '../metrics-query';
import {
  LAST_24H_BASELINE_MAX_AGE_MS,
  LAST_24H_BASELINE_MIN_AGE_MS,
  LAST_24H_LATEST_MAX_AGE_MS,
  computeLast24h,
  readingFromRecord,
  type DailyReadingInput,
  type Last24hPostInput,
} from '../last-24h';
import { logger } from '@/lib/logger';

const NOW = new Date('2026-11-22T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const PERSONA = '11111111-2222-4333-8444-555555555555';
const OTHER_PERSONA = '99999999-2222-4333-8444-555555555555';

const YT_OUTCOME = { provider: 'youtube', accountId: 'yt', status: 'published', videoUrl: 'https://www.youtube.com/shorts/abc123' };
const IG_OUTCOME = { provider: 'instagram', accountId: 'ig1', status: 'published', postId: 'ig-media-1' };

function ago(hours: number, from: Date = NOW): string {
  return new Date(from.getTime() - hours * HOUR).toISOString();
}

function post(overrides: Partial<Last24hPostInput> = {}): Last24hPostInput {
  return {
    id: 'post-1',
    personaId: PERSONA,
    publishedAt: ago(72),
    outcomes: [YT_OUTCOME],
    voiceover: false,
    ...overrides,
  };
}

function reading(overrides: Partial<DailyReadingInput> = {}): DailyReadingInput {
  return {
    postId: 'post-1',
    provider: 'youtube',
    externalId: 'abc123',
    collectedAt: ago(1),
    views: 1000,
    likes: 100,
    comments: 10,
    saves: 5,
    ...overrides,
  };
}

function query(overrides: Partial<Last24hQuery> = {}): Last24hQuery {
  return { personaId: null, accountId: null, provider: null, ...overrides };
}

function compute(input: Partial<Parameters<typeof computeLast24h>[0]> = {}): ReturnType<typeof computeLast24h> {
  return computeLast24h({
    readings: [reading()],
    posts: [post()],
    query: query(),
    now: NOW,
    ...input,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('computeLast24h deltas', () => {
  it('subtracts the reading about 24 hours earlier, never the lifetime total', () => {
    const result = compute({
      readings: [reading({ collectedAt: ago(1), views: 1000, likes: 100, comments: 10, saves: 5 }), reading({ collectedAt: ago(25), views: 700, likes: 90, comments: 10, saves: 1 })],
    });
    expect(result.rows).toEqual([{
      postId: 'post-1', personaId: PERSONA, provider: 'youtube', accountId: 'yt', externalId: 'abc123',
      publishedAt: ago(72), views: 300, likes: 10, comments: 0, saves: 4, baseline: 'reading',
      collectedAt: ago(1), baselineCollectedAt: ago(25),
    }]);
    expect(result.totals).toEqual({ views: 300, engagement: 14, videos: 1, measurements: 1 });
    expect(result.skipped).toEqual({ noBaseline: 0, stale: 0 });
    expect(result.counterResets).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.asOf).toBe(ago(1));
  });

  it('counts the whole lifetime of a video published 3 hours ago', () => {
    const result = compute({
      posts: [post({ publishedAt: ago(3) })],
      readings: [reading({ views: 40, likes: 4, comments: 0, saves: 1 })],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ views: 40, likes: 4, comments: 0, saves: 1, baseline: 'lifetime', baselineCollectedAt: null });
    expect(result.skipped.noBaseline).toBe(0);
  });

  it('counts the whole lifetime of a video published 22 hours ago even when an earlier reading sits in the baseline band', () => {
    const result = compute({
      posts: [post({ publishedAt: ago(22) })],
      readings: [reading({ collectedAt: ago(1), views: 900 }), reading({ collectedAt: ago(21), views: 100 })],
    });
    expect(result.rows[0]).toMatchObject({ views: 900, baseline: 'lifetime', baselineCollectedAt: null });
  });

  it('does not list a 3-day-old video that has no reading from about 24 hours earlier, and counts it as skipped', () => {
    const result = compute({ readings: [reading({ views: 5000 })] });
    expect(result.rows).toEqual([]);
    expect(result.totals).toEqual({ views: 0, engagement: 0, videos: 0, measurements: 0 });
    expect(result.skipped).toEqual({ noBaseline: 1, stale: 0 });
    expect(result.asOf).toBeNull();
  });

  it('treats a baseline exactly at both tolerance edges as usable and one minute outside as missing', () => {
    const latest = reading({ collectedAt: ago(1), views: 1000 });
    const edge = (ageMs: number): ReturnType<typeof computeLast24h> => compute({
      readings: [latest, reading({ collectedAt: new Date(Date.parse(latest.collectedAt) - ageMs).toISOString(), views: 400 })],
    });
    expect(edge(LAST_24H_BASELINE_MIN_AGE_MS).rows[0]?.views).toBe(600);
    expect(edge(LAST_24H_BASELINE_MAX_AGE_MS).rows[0]?.views).toBe(600);
    expect(edge(LAST_24H_BASELINE_MIN_AGE_MS - 60_000).skipped.noBaseline).toBe(1);
    expect(edge(LAST_24H_BASELINE_MAX_AGE_MS + 60_000).skipped.noBaseline).toBe(1);
  });

  it('picks the baseline closest to 24 hours before the latest reading', () => {
    const result = compute({
      readings: [
        reading({ collectedAt: ago(1), views: 1000 }),
        reading({ collectedAt: ago(22), views: 900 }),
        reading({ collectedAt: ago(24.5), views: 800 }),
        reading({ collectedAt: ago(27), views: 100 }),
      ],
    });
    expect(result.rows[0]).toMatchObject({ views: 200, baselineCollectedAt: ago(24.5) });
  });

  it('uses the latest reading of a video even when older readings exist', () => {
    const result = compute({
      readings: [reading({ collectedAt: ago(25), views: 700 }), reading({ collectedAt: ago(2), views: 900 }), reading({ collectedAt: ago(1), views: 1000 })],
    });
    expect(result.rows[0]).toMatchObject({ views: 300, collectedAt: ago(1) });
  });

  it('keeps a delta null when a provider does not report that counter, never 0', () => {
    const result = compute({
      readings: [reading({ collectedAt: ago(1), views: 100, likes: null, comments: 7, saves: null }), reading({ collectedAt: ago(25), views: 60, likes: null, comments: null, saves: 3 })],
    });
    expect(result.rows[0]).toMatchObject({ views: 40, likes: null, comments: null, saves: null });
    expect(result.totals).toMatchObject({ views: 40, engagement: 0 });
  });

  it('keeps a null counter null on a lifetime baseline', () => {
    const result = compute({
      posts: [post({ publishedAt: ago(3) })],
      readings: [reading({ views: 12, likes: null, comments: null, saves: null })],
    });
    expect(result.rows[0]).toMatchObject({ views: 12, likes: null, comments: null, saves: null });
  });
});

describe('computeLast24h counter resets', () => {
  it('clamps a negative delta to 0, counts it and logs the video', () => {
    const result = compute({
      readings: [reading({ collectedAt: ago(1), views: 500, likes: 100 }), reading({ collectedAt: ago(25), views: 800, likes: 90 })],
    });
    expect(result.rows[0]).toMatchObject({ views: 0, likes: 10 });
    expect(result.counterResets).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith('[metrics-last-24h] counter went backwards; clamped to 0', {
      postId: 'post-1', provider: 'youtube', externalId: 'abc123', resets: 1,
    });
  });

  it('counts every reset counter of every video and logs nothing when no counter went backwards', () => {
    const clean = compute({
      readings: [reading({ collectedAt: ago(1), views: 800 }), reading({ collectedAt: ago(25), views: 800 })],
    });
    expect(clean.counterResets).toBe(0);
    expect(logger.warn).not.toHaveBeenCalled();

    const result = compute({
      posts: [post(), post({ id: 'post-2', outcomes: [IG_OUTCOME] })],
      readings: [
        reading({ collectedAt: ago(1), views: 1, likes: 1, comments: 1, saves: 1 }),
        reading({ collectedAt: ago(25), views: 5, likes: 5, comments: 5, saves: 5 }),
        reading({ postId: 'post-2', provider: 'instagram', externalId: 'ig-media-1', collectedAt: ago(1), views: 1 }),
        reading({ postId: 'post-2', provider: 'instagram', externalId: 'ig-media-1', collectedAt: ago(25), views: 9 }),
      ],
    });
    expect(result.counterResets).toBe(5);
    expect(result.totals.views).toBe(0);
  });

  it('never clamps a lifetime baseline', () => {
    const result = compute({ posts: [post({ publishedAt: ago(3) })], readings: [reading({ views: 0, likes: 0, comments: 0, saves: 0 })] });
    expect(result.counterResets).toBe(0);
    expect(result.rows[0]).toMatchObject({ views: 0, baseline: 'lifetime' });
  });
});

describe('computeLast24h stale readings', () => {
  it('skips a video whose latest reading is older than the freshness limit and counts it as stale', () => {
    const latestAt = new Date(NOW.getTime() - LAST_24H_LATEST_MAX_AGE_MS - 60_000).toISOString();
    const result = compute({
      readings: [reading({ collectedAt: latestAt, views: 900 }), reading({ collectedAt: new Date(Date.parse(latestAt) - 24 * HOUR).toISOString(), views: 800 })],
    });
    expect(result.rows).toEqual([]);
    expect(result.skipped).toEqual({ noBaseline: 0, stale: 1 });
  });

  it('keeps a video whose latest reading is exactly at the freshness limit', () => {
    const latestAt = new Date(NOW.getTime() - LAST_24H_LATEST_MAX_AGE_MS).toISOString();
    const result = compute({
      readings: [reading({ collectedAt: latestAt, views: 900 }), reading({ collectedAt: new Date(Date.parse(latestAt) - 24 * HOUR).toISOString(), views: 800 })],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.skipped.stale).toBe(0);
  });
});

describe('computeLast24h filters and scope', () => {
  const twoPersonaInput = (): Pick<Parameters<typeof computeLast24h>[0], 'posts' | 'readings'> => ({
    posts: [
      post({ id: 'post-1', personaId: PERSONA }),
      post({ id: 'post-2', personaId: OTHER_PERSONA }),
      post({ id: 'post-3', personaId: null, voiceover: true }),
      post({ id: 'post-4', personaId: null, voiceover: false }),
    ],
    readings: ['post-1', 'post-2', 'post-3', 'post-4'].flatMap((id) => [
      reading({ postId: id, collectedAt: ago(1), views: 10 }),
      reading({ postId: id, collectedAt: ago(25), views: 5 }),
    ]),
  });

  it('shows a persona-scoped key only its personas plus voiceover posts, hiding orphaned persona-less posts', () => {
    const result = compute({ ...twoPersonaInput(), personaIds: [PERSONA] });
    expect(result.rows.map((row) => row.postId).sort()).toEqual(['post-1', 'post-3']);
    expect(result.totals.measurements).toBe(2);
  });

  it('shows a scoped key with no personas only voiceover posts', () => {
    const result = compute({ ...twoPersonaInput(), personaIds: [] });
    expect(result.rows.map((row) => row.postId)).toEqual(['post-3']);
  });

  it('does not count out-of-scope videos in skipped or resets', () => {
    const outOfScope = [
      post({ id: 'out-nobase', personaId: OTHER_PERSONA }),
      post({ id: 'out-stale', personaId: OTHER_PERSONA }),
      post({ id: 'out-reset', personaId: OTHER_PERSONA }),
    ];
    const staleAt = new Date(NOW.getTime() - LAST_24H_LATEST_MAX_AGE_MS - HOUR).toISOString();
    const readings = [
      reading({ postId: 'out-nobase', collectedAt: ago(1) }),
      reading({ postId: 'out-stale', collectedAt: staleAt }),
      reading({ postId: 'out-reset', collectedAt: ago(1), views: 1 }),
      reading({ postId: 'out-reset', collectedAt: ago(25), views: 9 }),
    ];
    const scoped = compute({ posts: outOfScope, readings, personaIds: [PERSONA] });
    expect(scoped.rows).toEqual([]);
    expect(scoped.skipped).toEqual({ noBaseline: 0, stale: 0 });
    expect(scoped.counterResets).toBe(0);
    expect(logger.warn).not.toHaveBeenCalled();

    const unscoped = compute({ posts: outOfScope, readings });
    expect(unscoped.skipped).toEqual({ noBaseline: 1, stale: 1 });
    expect(unscoped.counterResets).toBe(1);
  });

  it('shows every post to an unscoped caller', () => {
    expect(compute(twoPersonaInput()).rows).toHaveLength(4);
  });

  it('filters by persona, by the none sentinel, by account and by provider', () => {
    const input = twoPersonaInput();
    expect(compute({ ...input, query: query({ personaId: OTHER_PERSONA }) }).rows.map((row) => row.postId)).toEqual(['post-2']);
    expect(compute({ ...input, query: query({ personaId: METRICS_NONE }) }).rows.map((row) => row.postId).sort()).toEqual(['post-3', 'post-4']);
    expect(compute({ ...input, query: query({ accountId: 'other' }) }).rows).toEqual([]);
    expect(compute({ ...input, query: query({ accountId: 'yt' }) }).rows).toHaveLength(4);
    expect(compute({ ...input, query: query({ provider: 'instagram' }) }).rows).toEqual([]);
    expect(compute({ ...input, query: query({ provider: 'youtube' }) }).rows).toHaveLength(4);
  });

  it('applies the scope and the persona filter together', () => {
    const result = compute({ ...twoPersonaInput(), personaIds: [PERSONA], query: query({ personaId: OTHER_PERSONA }) });
    expect(result.rows).toEqual([]);
  });
});

describe('computeLast24h ordering, totals and bounds', () => {
  it('sorts by views gained, null views last, and counts unique videos apart from measurements', () => {
    const result = compute({
      posts: [post({ id: 'post-1', outcomes: [YT_OUTCOME, IG_OUTCOME] }), post({ id: 'post-2', outcomes: [IG_OUTCOME] })],
      readings: [
        reading({ postId: 'post-1', collectedAt: ago(1), views: 50 }),
        reading({ postId: 'post-1', collectedAt: ago(25), views: 10 }),
        reading({ postId: 'post-1', provider: 'instagram', externalId: 'ig-media-1', collectedAt: ago(1), views: 200 }),
        reading({ postId: 'post-1', provider: 'instagram', externalId: 'ig-media-1', collectedAt: ago(25), views: 100 }),
        reading({ postId: 'post-2', provider: 'instagram', externalId: 'ig-media-1', collectedAt: ago(1), views: null, likes: 3 }),
        reading({ postId: 'post-2', provider: 'instagram', externalId: 'ig-media-1', collectedAt: ago(25), views: null, likes: 1 }),
      ],
    });
    expect(result.rows.map((row) => `${row.postId}/${row.provider}/${row.views}`)).toEqual([
      'post-1/instagram/100', 'post-1/youtube/40', 'post-2/instagram/null',
    ]);
    expect(result.totals).toEqual({ views: 140, engagement: 2, videos: 2, measurements: 3 });
  });

  it('caps the rows at the row limit and reports truncated', () => {
    const count = METRICS_ROW_LIMIT + 1;
    const posts: Last24hPostInput[] = [];
    const readings: DailyReadingInput[] = [];
    for (let i = 0; i < count; i += 1) {
      posts.push(post({ id: `p${i}` }));
      readings.push(reading({ postId: `p${i}`, collectedAt: ago(1), views: 10 + i }), reading({ postId: `p${i}`, collectedAt: ago(25), views: 0 }));
    }
    const result = compute({ posts, readings });
    expect(result.rows).toHaveLength(METRICS_ROW_LIMIT);
    expect(result.truncated).toBe(true);
    expect(result.rows[0]?.views).toBe(10 + count - 1);
    expect(result.totals.measurements).toBe(METRICS_ROW_LIMIT);
  });

  it('is not truncated at exactly the row limit', () => {
    const posts: Last24hPostInput[] = [];
    const readings: DailyReadingInput[] = [];
    for (let i = 0; i < METRICS_ROW_LIMIT; i += 1) {
      posts.push(post({ id: `p${i}` }));
      readings.push(reading({ postId: `p${i}`, collectedAt: ago(1) }), reading({ postId: `p${i}`, collectedAt: ago(25), views: 0 }));
    }
    expect(compute({ posts, readings }).truncated).toBe(false);
  });
});

describe('computeLast24h defensive branches', () => {
  it('logs and skips a reading whose post is unknown', () => {
    const result = compute({ posts: [] });
    expect(result.rows).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('[metrics-last-24h] reading skipped: post not found', { postId: 'post-1' });
  });

  it('logs and skips a reading that no publish outcome explains', () => {
    const result = compute({ posts: [post({ outcomes: [IG_OUTCOME] })] });
    expect(result.rows).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('[metrics-last-24h] reading skipped: no publish target', {
      postId: 'post-1', provider: 'youtube', externalId: 'abc123',
    });
  });

  it('ignores a reading with an unparseable timestamp', () => {
    const result = compute({ readings: [reading({ collectedAt: 'not-a-date' })] });
    expect(result.rows).toEqual([]);
    expect(result.skipped).toEqual({ noBaseline: 0, stale: 0 });
  });

  it('treats an unparseable publish date as published long ago', () => {
    const result = compute({ posts: [post({ publishedAt: 'garbage' })] });
    expect(result.rows).toEqual([]);
    expect(result.skipped.noBaseline).toBe(1);
  });
});

describe('readingFromRecord', () => {
  const record = {
    post_id: 'post-1', provider: 'youtube', external_id: 'abc', collected_at: '2026-11-22T11:00:00Z',
    views: 10, likes: '4', comments: null, saves: undefined,
  };

  it('maps a row and coerces numeric strings and absent counters', () => {
    expect(readingFromRecord(record)).toEqual({
      postId: 'post-1', provider: 'youtube', externalId: 'abc', collectedAt: '2026-11-22T11:00:00Z',
      views: 10, likes: 4, comments: null, saves: null,
    });
  });

  it.each([
    { post_id: 1 }, { provider: 'tiktok' }, { external_id: null }, { collected_at: 5 },
  ])('rejects a row with a bad field %j', (override) => {
    expect(readingFromRecord({ ...record, ...override })).toBeNull();
  });
});
