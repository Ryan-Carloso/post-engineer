import type { ScheduledSlot } from '@/lib/api';
import type { Locale } from '@/lib/i18n';
import { calendarGroupOf, type CalendarGroup } from './status';

export interface CalendarDay {
  key: string;
  date: Date;
  inMonth: boolean;
}

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

export function gridRange(grid: CalendarDay[][]): { from: string; to: string } {
  const first = grid[0][0].date;
  const last = grid[grid.length - 1][6].date;
  return { from: first.toISOString(), to: addDays(last, 1).toISOString() };
}

export function weekStart(date: Date, weekStartsOn: 0 | 1): Date {
  const offset = (date.getDay() - weekStartsOn + 7) % 7;
  return addDays(date, -offset);
}

export function weekRange(date: Date, weekStartsOn: 0 | 1): { from: string; to: string } {
  const start = weekStart(date, weekStartsOn);
  return { from: start.toISOString(), to: addDays(start, 7).toISOString() };
}

export function unionRange(a: { from: string; to: string }, b: { from: string; to: string }): { from: string; to: string } {
  return { from: a.from < b.from ? a.from : b.from, to: a.to > b.to ? a.to : b.to };
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

export function calendarCounts(slots: Pick<ScheduledSlot, 'status'>[]): Record<CalendarGroup, number> {
  const counts: Record<CalendarGroup, number> = { published: 0, failed: 0, inProgress: 0, scheduled: 0 };
  for (const slot of slots) counts[calendarGroupOf(slot.status)] += 1;
  return counts;
}

export function defaultDayForMonth(year: number, month: number, todayKey: string, dayKeysWithPosts: Iterable<string>): string {
  const prefix = `${monthKey(year, month)}-`;
  if (todayKey.startsWith(prefix)) return todayKey;
  let first: string | null = null;
  for (const key of dayKeysWithPosts) {
    if (key.startsWith(prefix) && (first === null || key < first)) first = key;
  }
  return first ?? `${prefix}01`;
}

export function countMonthPosts(slotsByDay: Map<string, unknown[]>, year: number, month: number): number {
  const prefix = `${monthKey(year, month)}-`;
  let count = 0;
  for (const [key, slots] of slotsByDay) if (key.startsWith(prefix)) count += slots.length;
  return count;
}

export interface PersonaPhoto {
  avatarUrl?: string;
  photoUrl?: string;
  libraryUrl?: string;
  name: string;
}
