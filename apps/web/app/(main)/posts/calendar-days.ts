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

// The same day-of-month in another month, clamped to that month's last
// day (Jan 31 -> Feb 28). Month navigation keeps the selected day in the
// month being shown instead of leaving the detail below on a day from the
// month just left.
export function sameDayInMonth(selectedKey: string, year: number, month: number): string {
  const day = dateFromKey(selectedKey).getDate();
  const lastDay = new Date(year, month + 1, 0).getDate();
  return `${year}-${pad(month + 1)}-${pad(Math.min(day, lastDay))}`;
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
// The persona photo a day cell shows, resolved from the joins the page
// already loads (schedule -> persona -> photo URLs). The avatar renders the
// photo when it has one and the persona initials otherwise, so a persona
// without a photo URL still resolves.
//---------------

export interface PersonaPhoto {
  avatarUrl?: string;
  photoUrl?: string;
  libraryUrl?: string;
  name: string;
}

export type DayRing = 'published' | 'failed' | 'scheduled';

export interface DayPhoto {
  persona: PersonaPhoto;
  ring: DayRing;
  mixed: boolean;
}

// The photo is the most relevant post's persona — a failed post first (it
// needs attention), then a published one, then the earliest scheduled post —
// while the ring reports the whole day: failed wins over published, and a
// day holding both is mixed (split ring). The photo falls through to the
// next post when a slot's schedule or persona is gone, but the ring still
// counts that post: a failed post with no persona behind it is still a
// failure.
export function dayPhoto(
  slots: Pick<ScheduledSlot, 'status' | 'scheduleId' | 'slotAt'>[],
  scheduleById: Map<string, Pick<ScheduleConfig, 'personaId'>>,
  personaPhotoById: Map<string, PersonaPhoto>,
): DayPhoto | null {
  if (slots.length === 0) return null;
  const counts = calendarCounts(slots);
  const ring: DayRing = counts.failed > 0 ? 'failed' : counts.published > 0 ? 'published' : 'scheduled';
  const mixed = counts.published > 0 && counts.failed > 0;
  const byTime = [...slots].sort((a, b) => a.slotAt.localeCompare(b.slotAt));
  const resolve = (slot: Pick<ScheduledSlot, 'scheduleId'>): PersonaPhoto | undefined => {
    const personaId = scheduleById.get(slot.scheduleId)?.personaId ?? null;
    return personaId === null ? undefined : personaPhotoById.get(personaId);
  };
  for (const group of ['failed', 'published', 'scheduled'] as const) {
    const slot = byTime.find((candidate) => calendarGroupOf(candidate.status) === group && resolve(candidate) !== undefined);
    if (slot !== undefined) {
      const persona = resolve(slot);
      if (persona !== undefined) return { persona, ring, mixed };
    }
  }
  return null;
}
