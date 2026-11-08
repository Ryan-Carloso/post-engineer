import { describe, expect, it } from 'vitest';
import type { ScheduledSlot } from '@/lib/api';
import {
  bucketByDay,
  buildMonthGrid,
  calendarCounts,
  dayKey,
  dayPhoto,
  gridRange,
} from '../calendar-days';
import { calendarGroupOf, statusGroupOf } from '../status';

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

describe('calendar groups and day counts', () => {
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

  // The calendar shows only outcomes (published / failed): anything not
  // yet published counts as scheduled, with no status color of its own.
  it('maps unpublished statuses to scheduled on the calendar', () => {
    for (const status of ['pending', 'awaiting', 'generating', 'ready', 'publishing', 'something-new']) {
      expect(calendarGroupOf(status)).toBe('scheduled');
    }
    expect(calendarGroupOf('published')).toBe('published');
    expect(calendarGroupOf('completed')).toBe('published');
    expect(calendarGroupOf('failed')).toBe('failed');
  });

  it('counts published, failed and scheduled', () => {
    expect(
      calendarCounts([
        { status: 'awaiting' as const },
        { status: 'ready' as const },
        { status: 'published' as const },
        { status: 'failed' as const },
      ]),
    ).toEqual({ published: 1, failed: 1, scheduled: 2 });
  });
});

describe('dayPhoto — the persona photo and ring a calendar day shows', () => {
  const schedules = new Map([
    ['s1', { personaId: 'p1' }],
    ['s2', { personaId: 'p2' }],
    ['s3', { personaId: 'p3' }],
    ['s4', { personaId: null }],
  ]);
  const photos = new Map([
    ['p1', { name: 'Viva Leve', avatarUrl: 'https://example.test/viva.jpg' }],
    ['p2', { name: 'Bicuda', photoUrl: 'https://example.test/bicuda.jpg' }],
    // p3 has a name but no photo URL: the avatar falls back to initials,
    // so the day still resolves to that persona.
    ['p3', { name: 'No Photo' }],
  ]);
  const slot = (status: ScheduledSlot['status'], scheduleId: string, slotAt: string) => ({ status, scheduleId, slotAt });

  it('returns null with no slots', () => {
    expect(dayPhoto([], schedules, photos)).toBeNull();
  });

  it('returns null when no slot resolves to a known persona', () => {
    expect(dayPhoto([slot('published', 's-gone', '2030-06-05T10:00:00.000Z')], schedules, photos)).toBeNull();
    expect(dayPhoto([slot('published', 's4', '2030-06-05T10:00:00.000Z')], schedules, photos)).toBeNull();
  });

  it('shows the published ring for a published-only day', () => {
    expect(dayPhoto([slot('published', 's2', '2030-06-05T10:00:00.000Z')], schedules, photos)).toEqual({
      persona: { name: 'Bicuda', photoUrl: 'https://example.test/bicuda.jpg' },
      ring: 'published',
      mixed: false,
    });
  });

  it('shows the failed ring for a failed-only day', () => {
    expect(dayPhoto([slot('failed', 's1', '2030-06-05T10:00:00.000Z')], schedules, photos)).toEqual({
      persona: { name: 'Viva Leve', avatarUrl: 'https://example.test/viva.jpg' },
      ring: 'failed',
      mixed: false,
    });
  });

  it('shows no status ring for a scheduled-only day', () => {
    expect(dayPhoto([slot('awaiting', 's1', '2030-06-05T10:00:00.000Z')], schedules, photos)).toEqual({
      persona: { name: 'Viva Leve', avatarUrl: 'https://example.test/viva.jpg' },
      ring: 'scheduled',
      mixed: false,
    });
  });

  it('marks a published-plus-failed day as mixed, with the failed ring and the failed post persona', () => {
    expect(
      dayPhoto(
        [
          slot('published', 's2', '2030-06-05T10:00:00.000Z'),
          slot('failed', 's1', '2030-06-05T12:00:00.000Z'),
        ],
        schedules,
        photos,
      ),
    ).toEqual({
      persona: { name: 'Viva Leve', avatarUrl: 'https://example.test/viva.jpg' },
      ring: 'failed',
      mixed: true,
    });
  });

  it('prefers the published post persona over a merely scheduled one', () => {
    expect(
      dayPhoto(
        [
          slot('awaiting', 's1', '2030-06-05T09:00:00.000Z'),
          slot('published', 's2', '2030-06-05T10:00:00.000Z'),
        ],
        schedules,
        photos,
      ),
    ).toEqual({
      persona: { name: 'Bicuda', photoUrl: 'https://example.test/bicuda.jpg' },
      ring: 'published',
      mixed: false,
    });
  });

  it('picks the earliest post inside the winning tier, whatever the input order', () => {
    expect(
      dayPhoto(
        [
          slot('failed', 's1', '2030-06-05T12:00:00.000Z'),
          slot('failed', 's2', '2030-06-05T09:00:00.000Z'),
        ],
        schedules,
        photos,
      ),
    ).toEqual({
      persona: { name: 'Bicuda', photoUrl: 'https://example.test/bicuda.jpg' },
      ring: 'failed',
      mixed: false,
    });
  });

  it('keeps the failed ring from an unresolvable failed post while the photo falls through to the next post', () => {
    expect(
      dayPhoto(
        [
          slot('failed', 's-gone', '2030-06-05T09:00:00.000Z'),
          slot('awaiting', 's1', '2030-06-05T10:00:00.000Z'),
        ],
        schedules,
        photos,
      ),
    ).toEqual({
      persona: { name: 'Viva Leve', avatarUrl: 'https://example.test/viva.jpg' },
      ring: 'failed',
      mixed: false,
    });
  });

  it('resolves a persona with no photo URL — the avatar shows its initials', () => {
    expect(dayPhoto([slot('published', 's3', '2030-06-05T10:00:00.000Z')], schedules, photos)).toEqual({
      persona: { name: 'No Photo' },
      ring: 'published',
      mixed: false,
    });
  });
});
