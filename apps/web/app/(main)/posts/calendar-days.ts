import type { ScheduledSlot } from '@/lib/api';
import type { Locale } from '@/lib/i18n';
import { STATUS_GROUP_ORDER, statusGroupOf, type StatusGroup } from './status';

//---------------
// Pure date helpers for the posts calendar.
//
// TIMEZONE: every day bucket uses the VIEWER'S timezone, not the persona's
// and not UTC. Intl's default zone is the browser zone. Tests pass an
// explicit IANA zone: assigning process.env.TZ does not move Date inside
// the Stryker worker (Node 22), so a stubbed TZ fails the dry run and
// mutation.json is never written. A slot at 23:30 local belongs to that
// local day; the same instant can sit in a different cell for a viewer in
// another timezone. Pinned by __tests__/calendar-days.test.ts.
//---------------

export interface CalendarDay {
  key: string; // local YYYY-MM-DD
  date: Date; // local midnight
  inMonth: boolean;
}

// First weekday of the month grid per locale (0 = Sunday, 1 = Monday).
// pt follows the Brazilian wall-calendar convention, en follows en-US.
export const FIRST_WEEKDAY: Record<Locale, 0 | 1> = { pt: 0, en: 0 };

export const INTL_TAG: Record<Locale, string> = { pt: 'pt-BR', en: 'en-US' };

const pad = (value: number): string => String(value).padStart(2, '0');

export function dayKey(date: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

// Parses a key made by dayKey back to local midnight.
export function dateFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function monthKey(year: number, month: number): string {
  return `${year}-${pad(month + 1)}`;
}

// Always 6 weeks, so the grid height does not jump between months.
export function buildMonthGrid(year: number, month: number, firstWeekday: 0 | 1): CalendarDay[][] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() - firstWeekday + 7) % 7;
  const start = addDays(first, -offset);
  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, index) => {
      const date = addDays(start, week * 7 + index);
      return { key: dayKey(date), date, inMonth: date.getMonth() === month };
    }),
  );
}

// [from, to) of the visible grid as UTC ISO instants for the range query.
export function gridRange(grid: CalendarDay[][]): { from: string; to: string } {
  const first = grid[0][0].date;
  const last = grid[grid.length - 1][6].date;
  return { from: first.toISOString(), to: addDays(last, 1).toISOString() };
}

export function bucketByDay<T extends Pick<ScheduledSlot, 'slotAt'>>(slots: T[], timeZone?: string): Map<string, T[]> {
  const buckets = new Map<string, T[]>();
  for (const slot of slots) {
    const key = dayKey(new Date(slot.slotAt), timeZone);
    const list = buckets.get(key);
    if (list) list.push(slot);
    else buckets.set(key, [slot]);
  }
  return buckets;
}

export function groupCounts(slots: Pick<ScheduledSlot, 'status'>[]): Record<StatusGroup, number> {
  const counts: Record<StatusGroup, number> = { inProgress: 0, published: 0, failed: 0 };
  for (const slot of slots) counts[statusGroupOf(slot.status)] += 1;
  return counts;
}

// At most `max` per-post markers (in-progress first, then published, then
// failed), plus how many more posts the cell collapses into "+N".
export const CELL_MARKER_LIMIT = 3;

export function cellMarkers(
  slots: Pick<ScheduledSlot, 'status'>[],
  max: number = CELL_MARKER_LIMIT,
): { markers: StatusGroup[]; overflow: number } {
  const counts = groupCounts(slots);
  const all = STATUS_GROUP_ORDER.flatMap((group) => Array<StatusGroup>(counts[group]).fill(group));
  return { markers: all.slice(0, max), overflow: Math.max(0, all.length - max) };
}
