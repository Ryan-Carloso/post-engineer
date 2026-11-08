import { describe, expect, it } from 'vitest';
import {
  bucketByDay,
  buildMonthGrid,
  cellMarkers,
  dayKey,
  groupCounts,
  gridRange,
  moveFocus,
  weekdayLabels,
} from '../calendar-days';
import { statusGroupOf } from '../status';

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

describe('weekdayLabels', () => {
  it('uses the locale month/weekday names starting on the first weekday', () => {
    expect(weekdayLabels('en', 0)[0].long).toBe('Sunday');
    expect(weekdayLabels('pt', 0)[0].long).toMatch(/domingo/i);
    expect(weekdayLabels('en', 1)[0].long).toBe('Monday');
  });
});

describe('status groups and cell markers', () => {
  it('maps every real slot and generation status to a group', () => {
    for (const status of ['pending', 'awaiting', 'generating', 'ready', 'publishing']) {
      expect(statusGroupOf(status)).toBe('inProgress');
    }
    expect(statusGroupOf('published')).toBe('published');
    expect(statusGroupOf('completed')).toBe('published');
    expect(statusGroupOf('failed')).toBe('failed');
  });

  it('treats an unknown status as in progress, never as published', () => {
    expect(statusGroupOf('something-new')).toBe('inProgress');
  });

  it('counts per group', () => {
    expect(groupCounts([{ status: 'awaiting' as const }, { status: 'ready' as const }, { status: 'published' as const }, { status: 'failed' as const }])).toEqual({
      inProgress: 2,
      published: 1,
      failed: 1,
    });
  });

  it('shows every post up to 3 markers without overflow', () => {
    expect(cellMarkers([{ status: 'failed' as const }, { status: 'published' as const }, { status: 'awaiting' as const }])).toEqual({
      markers: ['inProgress', 'published', 'failed'],
      overflow: 0,
    });
  });

  it('collapses more than 3 posts into +N', () => {
    const slots = Array.from({ length: 7 }, () => ({ status: 'published' as const }));
    expect(cellMarkers(slots)).toEqual({ markers: ['published', 'published', 'published'], overflow: 4 });
  });
});

describe('moveFocus', () => {
  const wed = new Date(2030, 5, 12); // Wednesday
  it('moves by day and week', () => {
    expect(dayKey(moveFocus('ArrowLeft', wed, 0) as Date)).toBe('2030-06-11');
    expect(dayKey(moveFocus('ArrowRight', wed, 0) as Date)).toBe('2030-06-13');
    expect(dayKey(moveFocus('ArrowUp', wed, 0) as Date)).toBe('2030-06-05');
    expect(dayKey(moveFocus('ArrowDown', wed, 0) as Date)).toBe('2030-06-19');
  });

  it('jumps to the week edges for the locale first weekday', () => {
    expect(dayKey(moveFocus('Home', wed, 0) as Date)).toBe('2030-06-09');
    expect(dayKey(moveFocus('End', wed, 0) as Date)).toBe('2030-06-15');
    expect(dayKey(moveFocus('Home', wed, 1) as Date)).toBe('2030-06-10');
    expect(dayKey(moveFocus('End', wed, 1) as Date)).toBe('2030-06-16');
  });

  it('changes month with PageUp/PageDown without overflowing short months', () => {
    expect(dayKey(moveFocus('PageDown', new Date(2030, 0, 31), 0) as Date)).toBe('2030-02-28');
    expect(dayKey(moveFocus('PageUp', wed, 0) as Date)).toBe('2030-05-12');
  });

  it('ignores other keys', () => {
    expect(moveFocus('a', wed, 0)).toBeNull();
  });
});
