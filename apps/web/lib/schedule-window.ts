//---------------
// schedule-window — valid window for target date/time scheduling.
// Product rule: minimum 24h in advance, maximum 30 days ahead.
//
// Callers pass the CONVERTED instant (a Date): timezone-aware parsing
// happens before this validator runs — see parseZonedDateTime in
// lib/timezone.ts, used by POST /api/videos/generate-and-schedule so a
// naive wall clock in the caller's timezone is not measured as if it
// were UTC.
//---------------

export const SCHEDULE_MIN_ADVANCE_HOURS = 24;
export const SCHEDULE_MIN_ADVANCE_MS = SCHEDULE_MIN_ADVANCE_HOURS * 60 * 60 * 1000;

export const SCHEDULE_MAX_AHEAD_DAYS = 30;
export const SCHEDULE_MAX_AHEAD_MS = SCHEDULE_MAX_AHEAD_DAYS * 24 * 60 * 60 * 1000;

export type ScheduleWindowResult =
  | { ok: true }
  | { ok: false; error: string };

//---------------
// validateScheduleWindow — validates a target datetime against the window
// [now + 24h, now + 30d]. Accepts a Date or an ISO string.
//---------------
export function validateScheduleWindow(
  target: Date | string | unknown,
  now: Date = new Date(),
): ScheduleWindowResult {
  const targetDate = typeof target === 'string' ? new Date(target) : target;

  if (!(targetDate instanceof Date) || Number.isNaN(targetDate.getTime())) {
    return { ok: false, error: 'scheduledAt must be a valid ISO date.' };
  }

  const diffMs = targetDate.getTime() - now.getTime();

  if (diffMs < SCHEDULE_MIN_ADVANCE_MS) {
    return {
      ok: false,
      error: `scheduledAt must be at least 24 hours in advance (earliest allowed is ${new Date(
        now.getTime() + SCHEDULE_MIN_ADVANCE_MS,
      ).toISOString()}).`,
    };
  }

  if (diffMs > SCHEDULE_MAX_AHEAD_MS) {
    return {
      ok: false,
      error: `scheduledAt cannot be more than 30 days in advance (latest allowed is ${new Date(
        now.getTime() + SCHEDULE_MAX_AHEAD_MS,
      ).toISOString()}).`,
    };
  }

  return { ok: true };
}
