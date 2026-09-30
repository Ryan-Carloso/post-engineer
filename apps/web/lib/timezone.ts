//---------------
// timezone — IANA timezone helpers (Intl-based, no extra dependency).
//
// Wall-clock <-> UTC conversion for scheduling: a naive "2026-10-01T14:00"
// sent together with timezone "Europe/Lisbon" means 14:00 in Lisbon, NOT
// 14:00 UTC (which is what `new Date(naive)` would assume per spec).
//---------------

//---------------
// isValidTimezone — IANA zone check. Uses the Intl constructor (which
// throws RangeError on unknown zones) instead of supportedValuesOf, whose
// list omits 'UTC' on some ICU builds.
//---------------
export function isValidTimezone(timezone: string): boolean {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

//---------------
// timezoneOffsetMs — the zone's UTC offset (ms) at the given instant,
// derived from Intl parts. Positive east of UTC.
//---------------
function timezoneOffsetMs(timeZone: string, date: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

//---------------
// zonedTimeToUtc — interpret a wall clock in `timeZone` as a UTC instant.
// Fixed-point iteration (utc = wallClock - offset(utc)); three passes
// converge even across DST transitions.
//---------------
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
  second = 0,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let utc = guess;
  for (let i = 0; i < 3; i++) {
    utc = guess - timezoneOffsetMs(timeZone, new Date(utc));
  }
  return new Date(utc);
}

export interface NaiveDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const NAIVE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

//---------------
// parseNaiveDateTime — "YYYY-MM-DDTHH:mm[:ss]" with NO offset →
// components, or null. Range-checked so "2026-13-40T99:99" fails loudly
// instead of rolling over into a different date.
//---------------
export function parseNaiveDateTime(value: string): NaiveDateTime | null {
  const match = NAIVE_RE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { year, month, day, hour, minute, second };
}

const OFFSET_RE = /(?:Z|[+-]\d{2}:?\d{2})$/;

//---------------
// hasExplicitOffset — true when the string carries Z or ±hh:mm / ±hhmm.
//---------------
export function hasExplicitOffset(value: string): boolean {
  return OFFSET_RE.test(value.trim());
}

//---------------
// parseZonedDateTime — the core scheduling parse:
// - explicit offset (Z or ±hh:mm) → respected as-is, `timeZone` ignored;
// - naive wall clock → interpreted in `timeZone`;
// - anything else → null (the caller maps it to a 400).
//---------------
export function parseZonedDateTime(value: unknown, timeZone: string): Date | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (hasExplicitOffset(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parts = parseNaiveDateTime(trimmed);
  if (!parts) return null;
  return zonedTimeToUtc(
    parts.year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    timeZone,
    parts.second,
  );
}

//---------------
// datePartsInTimezone — calendar Y/M/D of `date` as seen in `timeZone`.
//---------------
export function datePartsInTimezone(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

//---------------
// zonedTimeOnDate — "HH:MM" on the calendar date of `date` in `timeZone`,
// as a UTC instant. Used to place explicit times on a schedule's date.
// Returns null for malformed times.
//---------------
export function zonedTimeOnDate(date: Date, time: string, timeZone: string): Date | null {
  const match = TIME_RE.exec(time.trim());
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (hour > 23 || minute > 59) return null;
  const { year, month, day } = datePartsInTimezone(date, timeZone);
  return zonedTimeToUtc(year, month, day, hour, minute, timeZone);
}
