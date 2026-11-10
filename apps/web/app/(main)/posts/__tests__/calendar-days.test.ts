import { describe, expect, it } from 'vitest';
import {
  bucketByDay,
  buildMonthGrid,
  calendarCounts,
  calendarWeekdayShortLabels,
  countMonthPosts,
  dayKey,
  defaultDayForMonth,
  formatCalendarMonthCaption,
  gridRange,
} from '../calendar-days';
import {
  CALENDAR_GROUP_DOT,
  CALENDAR_GROUP_ICON,
  CALENDAR_GROUP_KEY,
  CALENDAR_GROUP_MARKER,
  CALENDAR_GROUP_ORDER,
  CALENDAR_GROUP_PILL,
  STATUS_KEY,
  calendarGroupOf,
} from '../status';

describe('day bucketing timezone (viewer browser timezone)', () => {
  // 2026-11-02T02:30Z is 23:30 on Nov 1 in São Paulo (UTC-3) but already
  // Nov 2 in UTC and Tokyo. The zone is an argument: process.env.TZ does
  // not move Date inside the Stryker worker, so a stubbed TZ fails there.
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

describe('formatCalendarMonthCaption', () => {
  it('matches the loaded calendar month title without a connecting preposition', () => {
    expect(formatCalendarMonthCaption(2030, 5, 'en')).toBe('June 2030');
    expect(formatCalendarMonthCaption(2030, 5, 'pt')).toBe('junho 2030');
    expect(formatCalendarMonthCaption(2030, 5, 'pt')).not.toMatch(/\bde\b/i);
  });
});

describe('calendarWeekdayShortLabels', () => {
  it('returns seven short weekday names starting on the locale first weekday', () => {
    expect(calendarWeekdayShortLabels('en', 0)).toHaveLength(7);
    expect(calendarWeekdayShortLabels('en', 0)[0]).toMatch(/Sun/i);
    expect(calendarWeekdayShortLabels('en', 1)[0]).toMatch(/Mon/i);
  });
});

describe('buildMonthGrid', () => {
  it('is always 6 weeks of 7 days starting on the locale first weekday', () => {
    const sunday = buildMonthGrid(2030, 5, 0); // June 2030 starts on a Saturday
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

describe('calendar groups and day counts', () => {
  // One vocabulary for the cells, legend, day summary and card pills:
  // running work is "in progress", waiting work is "scheduled".
  it('maps every real slot and generation status to a group', () => {
    for (const status of ['generating', 'publishing', 'running']) {
      expect(calendarGroupOf(status)).toBe('inProgress');
    }
    for (const status of ['pending', 'awaiting', 'ready']) {
      expect(calendarGroupOf(status)).toBe('scheduled');
    }
    expect(calendarGroupOf('published')).toBe('published');
    expect(calendarGroupOf('completed')).toBe('published');
    expect(calendarGroupOf('failed')).toBe('failed');
  });

  it('treats an unknown status as scheduled, never as published', () => {
    expect(calendarGroupOf('something-new')).toBe('scheduled');
  });

  it('counts failed, published, in progress and scheduled', () => {
    expect(
      calendarCounts([
        { status: 'awaiting' as const },
        { status: 'ready' as const },
        { status: 'generating' as const },
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

  it('gives every group a word, an icon, a marker and a card pill', () => {
    for (const group of CALENDAR_GROUP_ORDER) {
      expect(CALENDAR_GROUP_KEY[group]).toMatch(/^posts\.group/);
      expect(CALENDAR_GROUP_ICON[group]).toBeDefined();
      expect(CALENDAR_GROUP_MARKER[group]).not.toBe('');
      expect(CALENDAR_GROUP_PILL[group]).not.toBe('');
    }
    // The cell marker is a solid chip. The card pill is the same hue as a
    // soft tint, so a card does not shout the way a calendar chip does.
    expect(CALENDAR_GROUP_MARKER.inProgress).toBe('bg-info text-white');
    expect(CALENDAR_GROUP_DOT.scheduled).toBe('bg-muted-foreground');
    expect(CALENDAR_GROUP_DOT.published).toBe('bg-success');
    expect(CALENDAR_GROUP_PILL.inProgress).toBe('bg-info-soft text-info');
    expect(CALENDAR_GROUP_PILL.inProgress).not.toBe(CALENDAR_GROUP_MARKER.inProgress);
    expect(CALENDAR_GROUP_MARKER.failed).toBe('bg-destructive text-destructive-foreground');
    expect(CALENDAR_GROUP_PILL.failed).toBe('bg-destructive-soft text-destructive');
  });

  it('keeps the detail page word for an awaiting post: scheduled, not pending', () => {
    expect(STATUS_KEY.awaiting).toBe('posts.groupScheduled');
    // A standalone generation that has not started is still "pending".
    expect(STATUS_KEY.pending).toBe('posts.statusPending');
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
