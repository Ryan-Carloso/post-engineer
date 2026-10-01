//---------------
// slot-distribution — pure slot distribution for generate-and-schedule.
//
// The API route and the UI slot preview import this SAME function, so the
// preview always matches what the backend will create. No server imports:
// this module must stay importable from client components.
//
// Rules:
// - Topic order is preserved: the k-th publishable slot goes to topic k.
// - Slots iterate over (day, time): day = startAt's calendar date in
//   `timezone` + floor(k / times.length), time = sortedTimes[k % times.length].
// - Slots strictly before `startAt` are skipped; iteration keeps moving
//   forward (a single global cursor, so two topics never share a slot).
// - No recurrence: the times only distribute this operation's videos.
//---------------

import { datePartsInTimezone, isValidTimezone, zonedTimeToUtc } from '../timezone';

export interface DistributeSlotsInput {
  /** ISO instant the publishing window opens (offset-aware, e.g. 2026-10-02T18:00:00+01:00). */
  startAtISO: string;
  /** Daily publish times as "HH:MM". Sorted ascending internally. */
  times: string[];
  /** IANA timezone the times are wall-clock in. */
  timezone: string;
  /** Number of topics (slots to produce). */
  count: number;
}

export interface DistributedSlot {
  /** UTC instant of the slot, ISO string. */
  slotAtISO: string;
  /** Calendar days after startAt's date (in `timezone`). */
  dayIndex: number;
  /** Index into the sorted/deduped times array. */
  timeIndex: number;
}

/** Which request field a distribution failure maps to. */
export type SlotDistributionField = 'times' | 'timezone' | 'startAt' | 'count';

export class SlotDistributionError extends Error {
  readonly field: SlotDistributionField;

  constructor(field: SlotDistributionField, message: string) {
    super(message);
    this.name = 'SlotDistributionError';
    this.field = field;
  }
}

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

interface ParsedTime {
  hour: number;
  minute: number;
  label: string;
}

function parseTimes(times: string[]): ParsedTime[] {
  if (!Array.isArray(times) || times.length === 0) {
    throw new SlotDistributionError('times', 'At least one publishing time is required.');
  }
  const parsed: ParsedTime[] = times.map((raw) => {
    const value = typeof raw === 'string' ? raw.trim() : '';
    const match = TIME_RE.exec(value);
    if (!match) {
      throw new SlotDistributionError('times', `Invalid publishing time: "${raw}". Use "HH:MM".`);
    }
    const hour = Number.parseInt(match[1], 10);
    const minute = Number.parseInt(match[2], 10);
    if (hour > 23 || minute > 59) {
      throw new SlotDistributionError('times', `Invalid publishing time: "${raw}". Use "HH:MM".`);
    }
    return { hour, minute, label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
  });
  // Sort ascending and drop exact duplicates so two topics never share a slot.
  const seen = new Set<string>();
  return parsed
    .sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute))
    .filter((t) => {
      if (seen.has(t.label)) return false;
      seen.add(t.label);
      return true;
    });
}

export function distributeSlots(input: DistributeSlotsInput): DistributedSlot[] {
  const { startAtISO, times, timezone, count } = input;

  if (!Number.isInteger(count) || count < 1) {
    throw new SlotDistributionError('count', 'At least one topic is required.');
  }
  if (typeof timezone !== 'string' || !isValidTimezone(timezone)) {
    throw new SlotDistributionError('timezone', `Invalid timezone: "${timezone}".`);
  }
  const startAt = new Date(startAtISO);
  if (Number.isNaN(startAt.getTime())) {
    throw new SlotDistributionError('startAt', `Invalid startAt: "${startAtISO}".`);
  }

  const sorted = parseTimes(times);
  const perDay = sorted.length;
  const base = datePartsInTimezone(startAt, timezone);
  const startMs = startAt.getTime();

  const slots: DistributedSlot[] = [];
  // Global cursor over (day, time) pairs: skip anything before startAt,
  // keep iterating forward until `count` slots are placed.
  let k = 0;
  while (slots.length < count) {
    const dayIndex = Math.floor(k / perDay);
    const timeIndex = k % perDay;
    const t = sorted[timeIndex];
    // Date.UTC normalizes day overflow, so month/year boundaries just work;
    // zonedTimeToUtc re-resolves the zone offset per candidate (DST-safe).
    const candidate = zonedTimeToUtc(base.year, base.month, base.day + dayIndex, t.hour, t.minute, timezone);
    if (candidate.getTime() >= startMs) {
      slots.push({ slotAtISO: candidate.toISOString(), dayIndex, timeIndex });
    }
    k += 1;
  }
  return slots;
}
