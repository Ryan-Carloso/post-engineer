import { describe, expect, it } from 'vitest';
import {
  bucketByDay,
  buildMonthGrid,
  calendarCounts,
  countMonthPosts,
  dayKey,
  defaultDayForMonth,
  gridRange,
  unionRange,
  weekRange,
  weekStart,
} from '../calendar-days';
import {
  CALENDAR_GROUP_ICON,
  CALENDAR_GROUP_KEY,
  CALENDAR_GROUP_ORDER,
  CALENDAR_GROUP_PILL,
  STATUS_KEY,
  calendarGroupOf,
} from '../status';

describe('day bucketing timezone (viewer browser timezone)', () => {
  const slot = { slotAt: '2026-11-02T02:30:00.000Z' };

  it('puts a 23:30 local post on the local day, not the UTC day', () => {
    expect([...bucketByDay([slot], 'America/Sao_Paulo').keys()]).toEqual(['2026-11-01']);
  });

  it('moves the same instant to the next day for a viewer ahead of UTC', () => {
    expect([...bucketByDay([slot], 'Asia/Tokyo').keys()]).toEqual(['2026-11-02']);
  });

  it('keeps 00:30 local on the new day', () => {
    expect([...bucketByDay([{ slotAt: '2026-11-02T03:30:00.000Z' }], 'America/Sao_Paulo').keys()]).toEqual(['2026-11-02']);
  });

  it('formats keys with zero padding', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('uses the runtime timezone when the caller does not pass one', () => {
    const date = new Date(2026, 0, 5, 12);
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(dayKey(date)).toBe(dayKey(date, zone));
  });
});

describe('buildMonthGrid', () => {
  it('is always 6 weeks of 7 days starting on the locale first weekday', () => {
    const sunday = buildMonthGrid(2030, 5, 0);
    expect(sunday).toHaveLength(6);
    expect(sunday.every((week) => week.length === 7)).toBe(true);
    expect(sunday[0][0].date.getDay()).toBe(0);
    expect(sunday[0][6].key).toBe('2030-06-01');

    const monday = buildMonthGrid(2030, 5, 1);
    expect(monday[0][0].date.getDay()).toBe(1);
    expect(monday[0][5].key).toBe('2030-06-01');
  });

  it('flags only the days of the displayed month as in-month', () => {
    const days = buildMonthGrid(2030, 5, 0).flat();
    expect(days.filter((day) => day.inMonth)).toHaveLength(30);
  });

  it('spans well under the 62-day API range cap', () => {
    const { from, to } = gridRange(buildMonthGrid(2030, 5, 0));
    expect((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000).toBeLessThanOrEqual(43);
  });

  it('covers every day of the month inside [from, to)', () => {
    const grid = buildMonthGrid(2030, 11, 0);
    const { from, to } = gridRange(grid);
    expect(new Date(from).getTime()).toBeLessThanOrEqual(new Date(2030, 11, 1).getTime());
    expect(new Date(to).getTime()).toBeGreaterThan(new Date(2030, 11, 31, 23, 59).getTime());
  });
});

describe('week helpers', () => {
  it('starts the week on the locale first weekday', () => {
    expect(dayKey(weekStart(new Date(2030, 5, 1), 0))).toBe('2030-05-26');
    expect(dayKey(weekStart(new Date(2030, 5, 1), 1))).toBe('2030-05-27');
  });

  it('keeps a week-start day on itself', () => {
    expect(dayKey(weekStart(new Date(2030, 4, 26), 0))).toBe('2030-05-26');
    expect(dayKey(weekStart(new Date(2030, 4, 27), 1))).toBe('2030-05-27');
  });

  it('covers exactly seven days, [from, to)', () => {
    const { from, to } = weekRange(new Date(2030, 5, 1), 0);
    expect(dayKey(new Date(from))).toBe('2030-05-26');
    expect(dayKey(new Date(to))).toBe('2030-06-02');
    expect(new Date(to).getTime() - new Date(from).getTime()).toBe(7 * 86_400_000);
  });

  it('takes the widest bounds of two ranges', () => {
    const month = gridRange(buildMonthGrid(2030, 5, 0));
    const week = weekRange(new Date(2030, 6, 7), 0);
    const union = unionRange(month, week);
    expect(union.from).toBe(month.from);
    expect(union.to).toBe(week.to);
    expect(unionRange(month, month)).toEqual(month);
  });
});

describe('calendar groups and day counts', () => {
  it('maps every real slot status to a group', () => {
    expect(calendarGroupOf('publishing')).toBe('inProgress');
    expect(calendarGroupOf('ready')).toBe('scheduled');
    expect(calendarGroupOf('published')).toBe('published');
    expect(calendarGroupOf('failed')).toBe('failed');
  });

  it('treats an unknown status as scheduled, never as published', () => {
    expect(calendarGroupOf('something-new')).toBe('scheduled');
  });

  it('counts failed, published, in progress and scheduled', () => {
    expect(
      calendarCounts([
        { status: 'ready' as const },
        { status: 'ready' as const },
        { status: 'publishing' as const },
        { status: 'published' as const },
        { status: 'failed' as const },
      ]),
    ).toEqual({ published: 1, failed: 1, inProgress: 1, scheduled: 2 });
  });
});

describe('calendar vocabulary', () => {
  it('lists a failure first everywhere the calendar orders its groups', () => {
    expect(CALENDAR_GROUP_ORDER).toEqual(['failed', 'published', 'inProgress', 'scheduled']);
  });

  it('gives every group a word, an icon and a card pill', () => {
    for (const group of CALENDAR_GROUP_ORDER) {
      expect(CALENDAR_GROUP_KEY[group]).toMatch(/^posts\.group/);
      expect(CALENDAR_GROUP_ICON[group]).toBeDefined();
      expect(CALENDAR_GROUP_PILL[group]).not.toBe('');
    }
    expect(CALENDAR_GROUP_PILL.inProgress).toBe('bg-info-soft text-info');
    expect(CALENDAR_GROUP_PILL.failed).toBe('bg-destructive-soft text-destructive');
  });

  it('keeps the detail page word for a ready post', () => {
    expect(STATUS_KEY.ready).toBe('posts.statusReady');
    expect(STATUS_KEY.publishing).toBe('posts.statusPublishing');
  });
});

describe('defaultDayForMonth — the day month navigation selects', () => {
  it('selects today when the month holds today', () => {
    expect(defaultDayForMonth(2030, 5, '2030-06-15', ['2030-06-02'])).toBe('2030-06-15');
  });

  it("selects the month's first day with posts otherwise, ignoring other months and input order", () => {
    expect(defaultDayForMonth(2030, 6, '2030-06-15', ['2030-06-30', '2030-07-20', '2030-07-09', '2030-08-01'])).toBe(
      '2030-07-09',
    );
  });

  it('selects the 1st when the month has no posts', () => {
    expect(defaultDayForMonth(2030, 6, '2030-06-15', ['2030-06-30', '2030-08-01'])).toBe('2030-07-01');
    expect(defaultDayForMonth(2030, 11, '2030-06-15', [])).toBe('2030-12-01');
  });
});

describe('countMonthPosts', () => {
  it("counts only the posts on the month's own days", () => {
    const byDay = new Map<string, unknown[]>([
      ['2030-06-30', [1]],
      ['2030-07-01', [1, 2]],
      ['2030-07-31', [1]],
      ['2030-08-01', [1]],
    ]);
    expect(countMonthPosts(byDay, 2030, 6)).toBe(3);
    expect(countMonthPosts(byDay, 2030, 8)).toBe(0);
  });
});
