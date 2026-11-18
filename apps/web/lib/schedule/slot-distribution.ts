import { datePartsInTimezone, isValidTimezone, parseZonedDateTime, zonedTimeToUtc } from '../timezone';

export interface DistributeSlotsInput {
  startAtISO: string;
  times: string[];
  timezone: string;
  count: number;
}

export interface DistributedSlot {
  slotAtISO: string;
  dayIndex: number;
  timeIndex: number;
}

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
    throw new SlotDistributionError('count', 'At least one slot is required.');
  }
  if (typeof timezone !== 'string' || !isValidTimezone(timezone)) {
    throw new SlotDistributionError('timezone', `Invalid timezone: "${timezone}".`);
  }
  const startAt = parseZonedDateTime(startAtISO, timezone);
  if (startAt === null) {
    throw new SlotDistributionError('startAt', `Invalid startAt: "${startAtISO}".`);
  }

  const sorted = parseTimes(times);
  const perDay = sorted.length;
  const base = datePartsInTimezone(startAt, timezone);
  const startMs = startAt.getTime();

  const slots: DistributedSlot[] = [];
  let k = 0;
  while (slots.length < count) {
    const dayIndex = Math.floor(k / perDay);
    const timeIndex = k % perDay;
    const t = sorted[timeIndex];
    const candidate = zonedTimeToUtc(base.year, base.month, base.day + dayIndex, t.hour, t.minute, timezone);
    if (candidate.getTime() >= startMs) {
      slots.push({ slotAtISO: candidate.toISOString(), dayIndex, timeIndex });
    }
    k += 1;
  }
  return slots;
}
