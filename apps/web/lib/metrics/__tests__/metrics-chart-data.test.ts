import { describe, expect, it } from 'vitest';
import type { MetricsRowView } from '../metrics-query';
import {
  breakdownBy,
  bucketOverTime,
  countWithoutViews,
  dayKeyToDate,
  localDayKey,
  rowMetricValue,
  shouldUseDonut,
  topVideosByViews,
} from '../metrics-chart-data';

function row(overrides: Partial<MetricsRowView> = {}): MetricsRowView {
  return {
    postId: 'post-1',
    personaId: null,
    provider: 'youtube',
    accountId: 'UC1',
    externalId: 'v1',
    publishedAt: new Date(Date.now() - 86400000).toISOString(),
    views: 100,
    likes: 10,
    comments: 3,
    saves: 1,
    analyticsViews: null,
    engagedViews: null,
    stayedToWatchPct: null,
    averageViewDurationSeconds: null,
    averageViewPercentage: null,
    contentType: null,
    analyticsStatus: null,
    provisional: false,
    collectedAt: '2026-10-21T12:00:00Z',
    ...overrides,
  };
}

describe('rowMetricValue', () => {
  it('returns the reported value per metric', () => {
    const item = row({ views: 5, likes: 2, comments: 1, saves: 4 });
    expect(rowMetricValue(item, 'views')).toBe(5);
    expect(rowMetricValue(item, 'likes')).toBe(2);
    expect(rowMetricValue(item, 'comments')).toBe(1);
  });

  it('sums the reported engagement parts and skips nulls', () => {
    expect(rowMetricValue(row({ likes: 2, comments: null, saves: 4 }), 'engagement')).toBe(6);
    expect(rowMetricValue(row({ likes: null, comments: null, saves: null }), 'engagement')).toBeNull();
  });

  it('is null when the row reported nothing for the metric', () => {
    expect(rowMetricValue(row({ views: null }), 'views')).toBeNull();
  });
});

describe('localDayKey', () => {
  it('buckets by the day in the given time zone, not the UTC day', () => {
    expect(localDayKey('2026-10-21T02:30:00Z', { timeZone: 'America/Sao_Paulo' })).toBe('2026-10-20');
    expect(localDayKey('2026-10-21T02:30:00Z', { timeZone: 'Europe/Berlin' })).toBe('2026-10-21');
    expect(localDayKey('2026-10-21T02:30:00Z', { timeZone: 'UTC' })).toBe('2026-10-21');
  });

  it('uses the runtime time zone by default', () => {
    const iso = '2026-10-21T02:30:00Z';
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(localDayKey(iso)).toBe(localDayKey(iso, { timeZone: zone }));
  });

  it('returns null for a missing or unparseable date', () => {
    expect(localDayKey('')).toBeNull();
    expect(localDayKey('not-a-date')).toBeNull();
  });
});

describe('dayKeyToDate', () => {
  it('reconstructs the local noon of the keyed day', () => {
    const date = dayKeyToDate('2026-10-21');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(9);
    expect(date.getDate()).toBe(21);
  });
});

describe('bucketOverTime', () => {
  const day1 = new Date(Date.now() - 2 * 86400000).toISOString();
  const day2 = new Date(Date.now() - 86400000).toISOString();

  it('sums one metric per publish day, oldest first', () => {
    const result = bucketOverTime([
      row({ postId: 'a', publishedAt: day1, views: 10 }),
      row({ postId: 'b', publishedAt: day1, views: 5 }),
      row({ postId: 'c', publishedAt: day2, views: 7 }),
    ], 'views');
    expect(result.points).toHaveLength(2);
    expect(result.points[0].value).toBe(15);
    expect(result.points[1].value).toBe(7);
    expect(result.withoutPublishDate).toBe(0);
    expect(result.withoutMetricValue).toBe(0);
  });

  it('excludes null values from sums and counts them', () => {
    const result = bucketOverTime([
      row({ postId: 'a', publishedAt: day1, views: null }),
      row({ postId: 'b', publishedAt: day1, views: 4 }),
    ], 'views');
    const day = localDayKey(day1);
    expect(day).not.toBeNull();
    expect(result.points).toEqual([{ day, value: 4 }]);
    expect(result.withoutMetricValue).toBe(1);
  });

  it('leaves rows without a publish date out and counts them', () => {
    const result = bucketOverTime([
      row({ postId: 'a', publishedAt: '', views: 9 }),
      row({ postId: 'b', publishedAt: day1, views: 3 }),
    ], 'views');
    expect(result.points).toHaveLength(1);
    expect(result.withoutPublishDate).toBe(1);
  });

  it('emits no zero point for a day with no published video', () => {
    const result = bucketOverTime([row({ publishedAt: day1, views: 2 })], 'views');
    expect(result.points).toHaveLength(1);
  });

  it('one point per local day with day keys that format to the same local date (axis aligns)', () => {
    const sameDayA = new Date();
    sameDayA.setHours(9, 0, 0, 0);
    const sameDayB = new Date();
    sameDayB.setHours(18, 0, 0, 0);
    const otherDay = new Date(Date.now() - 86400000);
    otherDay.setHours(10, 0, 0, 0);
    const result = bucketOverTime([
      row({ postId: 'a', publishedAt: sameDayA.toISOString(), views: 10 }),
      row({ postId: 'b', publishedAt: sameDayB.toISOString(), views: 5 }),
      row({ postId: 'c', publishedAt: otherDay.toISOString(), views: 7 }),
    ], 'views');
    expect(result.points).toHaveLength(2);
    const days = result.points.map((p) => p.day);
    expect(days).toEqual([...days].sort((a, b) => a.localeCompare(b)));
    for (const point of result.points) {
      const date = dayKeyToDate(point.day);
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      expect(point.day).toBe(`${date.getFullYear()}-${month}-${day}`);
    }
    expect(result.points[0].value).toBe(7);
    expect(result.points[1].value).toBe(15);
  });
});

describe('breakdownBy', () => {
  it('totals views per provider, highest first', () => {
    const groups = breakdownBy([
      row({ postId: 'a', provider: 'youtube', views: 10 }),
      row({ postId: 'b', provider: 'instagram', views: 30 }),
      row({ postId: 'c', provider: 'youtube', views: 5 }),
    ], 'provider');
    expect(groups).toEqual([
      { key: 'instagram', value: 30 },
      { key: 'youtube', value: 15 },
    ]);
  });

  it('totals views per persona with persona-less posts under one key', () => {
    const groups = breakdownBy([
      row({ postId: 'a', personaId: 'p1', views: 10 }),
      row({ postId: 'b', personaId: null, views: 20 }),
    ], 'persona');
    expect(groups).toEqual([
      { key: 'no-persona', value: 20 },
      { key: 'p1', value: 10 },
    ]);
  });

  it('skips null views', () => {
    expect(breakdownBy([row({ views: null })], 'provider')).toEqual([]);
  });
});

describe('countWithoutViews', () => {
  it('counts rows with no reported views', () => {
    expect(countWithoutViews([
      row({ postId: 'a', views: null }),
      row({ postId: 'b', views: 0 }),
      row({ postId: 'c', views: 3 }),
    ])).toBe(1);
  });
});

describe('shouldUseDonut', () => {
  it('allows a donut up to five groups, bars past that', () => {
    expect(shouldUseDonut(5)).toBe(true);
    expect(shouldUseDonut(1)).toBe(true);
    expect(shouldUseDonut(6)).toBe(false);
  });
});

describe('topVideosByViews', () => {
  it('returns the most-viewed rows up to the limit', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row({ postId: `p${i}`, views: i + 1 }));
    const top = topVideosByViews(rows, 10);
    expect(top).toHaveLength(10);
    expect(top[0].views).toBe(12);
    expect(top[9].views).toBe(3);
  });

  it('never lists a row without reported views', () => {
    expect(topVideosByViews([row({ views: null })])).toEqual([]);
  });

  it('breaks view ties on the newest collection', () => {
    const top = topVideosByViews([
      row({ postId: 'old', views: 5, collectedAt: '2026-10-20T12:00:00Z' }),
      row({ postId: 'new', views: 5, collectedAt: '2026-10-21T12:00:00Z' }),
    ]);
    expect(top.map((item) => item.postId)).toEqual(['new', 'old']);
  });
});
