import type { ScheduledSlot, ScheduleConfig } from '@/lib/api';
import type { Locale } from '@/lib/i18n';
import { calendarGroupOf, type CalendarGroup } from './status';

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
// pt is pt-BR (INTL_TAG): Brazilian wall calendars start on Sunday, as
// en-US ones do — Monday would be the pt-PT convention, not this app's.
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

// Calendar counts: only outcomes (published / failed) plus scheduled —
// anything not yet published counts as scheduled, with no status color.
export function calendarCounts(slots: Pick<ScheduledSlot, 'status'>[]): Record<CalendarGroup, number> {
  const counts: Record<CalendarGroup, number> = { published: 0, failed: 0, scheduled: 0 };
  for (const slot of slots) counts[calendarGroupOf(slot.status)] += 1;
  return counts;
}

//---------------
// Month navigation picks one predictable day: today when the month holds
// today, otherwise the month's first day with posts (so the list below is
// never empty when the month has posts), otherwise the 1st. Keys are
// zero-padded YYYY-MM-DD, so string order is date order.
//---------------
export function defaultDayForMonth(year: number, month: number, todayKey: string, dayKeysWithPosts: Iterable<string>): string {
  const prefix = `${monthKey(year, month)}-`;
  if (todayKey.startsWith(prefix)) return todayKey;
  let first: string | null = null;
  for (const key of dayKeysWithPosts) {
    if (key.startsWith(prefix) && (first === null || key < first)) first = key;
  }
  return first ?? `${prefix}01`;
}

// Posts on the days of one month (outside days of the grid excluded).
export function countMonthPosts(slotsByDay: Map<string, unknown[]>, year: number, month: number): number {
  const prefix = `${monthKey(year, month)}-`;
  let count = 0;
  for (const [key, slots] of slotsByDay) if (key.startsWith(prefix)) count += slots.length;
  return count;
}

//---------------
// The personas a day cell shows, resolved from the joins the page already
// loads (schedule -> persona -> photo URLs). The avatar renders the photo
// when it has one and the persona initials otherwise, so a persona without
// a photo URL still resolves.
//---------------

export interface PersonaPhoto {
  avatarUrl?: string;
  photoUrl?: string;
  libraryUrl?: string;
  name: string;
}

// The distinct personas of a day, most relevant first — the persona of a
// failed post (it needs attention), then of a published one, then of the
// scheduled ones, each tier by time — capped at `max`. Slots whose schedule
// or persona is gone are skipped: the status markers still count them.
export function dayPersonas(
  slots: Pick<ScheduledSlot, 'status' | 'scheduleId' | 'slotAt'>[],
  scheduleById: Map<string, Pick<ScheduleConfig, 'personaId'>>,
  personaPhotoById: Map<string, PersonaPhoto>,
  max: number,
): PersonaPhoto[] {
  const tier: Record<CalendarGroup, number> = { failed: 0, published: 1, scheduled: 2 };
  const ordered = [...slots].sort(
    (a, b) => tier[calendarGroupOf(a.status)] - tier[calendarGroupOf(b.status)] || a.slotAt.localeCompare(b.slotAt),
  );
  const seen = new Set<string>();
  const personas: PersonaPhoto[] = [];
  for (const slot of ordered) {
    const personaId = scheduleById.get(slot.scheduleId)?.personaId ?? null;
    if (personaId === null || seen.has(personaId)) continue;
    const persona = personaPhotoById.get(personaId);
    if (persona === undefined) continue;
    seen.add(personaId);
    personas.push(persona);
    if (personas.length === max) break;
  }
  return personas;
}
