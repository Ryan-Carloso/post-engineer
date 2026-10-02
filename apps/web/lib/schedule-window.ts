//---------------
// schedule-window — valid window for target date/time scheduling.
// Product rule: minimum 3h in advance, maximum 30 days ahead.
//
// Callers pass the CONVERTED instant (a Date): timezone-aware parsing
// happens before this validator runs — the route passes slots already
// converted to UTC instants by distributeSlots (which converts via
// zonedTimeToUtc, lib/timezone.ts). The schedule form parses the naive
// start date with parseZonedDateTime but does not run this validator;
// the server enforces the window.
//---------------

export const SCHEDULE_MIN_ADVANCE_HOURS = 3;
export const SCHEDULE_MIN_ADVANCE_MS = SCHEDULE_MIN_ADVANCE_HOURS * 60 * 60 * 1000;

export const SCHEDULE_MAX_AHEAD_DAYS = 30;
export const SCHEDULE_MAX_AHEAD_MS = SCHEDULE_MAX_AHEAD_DAYS * 24 * 60 * 60 * 1000;

export type ScheduleWindowResult =
  | { ok: true }
  | { ok: false; error: string };

//---------------
// validateScheduleWindow — validates a target datetime against the window
// [now + 3h, now + 30d]. Accepts a Date or an ISO string.
//---------------
export function validateScheduleWindow(
  target: Date | string | unknown,
  now: Date = new Date(),
): ScheduleWindowResult {
  const targetDate = typeof target === 'string' ? new Date(target) : target;

  if (!(targetDate instanceof Date) || Number.isNaN(targetDate.getTime())) {
    return { ok: false, error: 'Publish time must be a valid ISO date.' };
  }

  const diffMs = targetDate.getTime() - now.getTime();

  if (diffMs < SCHEDULE_MIN_ADVANCE_MS) {
    return {
      ok: false,
      error: `Publish time must be at least ${SCHEDULE_MIN_ADVANCE_HOURS} hours in advance (earliest allowed is ${new Date(
        now.getTime() + SCHEDULE_MIN_ADVANCE_MS,
      ).toISOString()}).`,
    };
  }

  if (diffMs > SCHEDULE_MAX_AHEAD_MS) {
    return {
      ok: false,
      error: `Publish time cannot be more than ${SCHEDULE_MAX_AHEAD_DAYS} days in advance (latest allowed is ${new Date(
        now.getTime() + SCHEDULE_MAX_AHEAD_MS,
      ).toISOString()}).`,
    };
  }

  return { ok: true };
}
