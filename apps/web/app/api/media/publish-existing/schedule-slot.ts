//---------------
// The one slot of a scheduled publish-existing call. Existing media is
// published once, so the schedule is a single instant (`publishAt`), not
// generate-and-schedule's start + daily times: a list of times would
// accept several and silently use only the first.
//
// The slot is the instant itself, truncated to the minute, never re-derived
// from a wall-clock time: re-deriving it would move a publishAt inside the
// repeated hour of a DST fall-back to the other occurrence, or to the next
// day. The same 3h–30d window as generate-and-schedule applies.
//---------------

import type { NextResponse } from 'next/server';

import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES } from '@/lib/error-codes';
import type { DistributedSlot } from '@/lib/schedule/slot-distribution';
import { validateScheduleWindow } from '@/lib/schedule-window';
import { isValidTimezone, parseZonedDateTime, utcToZonedInputValue } from '@/lib/timezone';

export interface PublishAtSlot {
  /** Exactly one slot, at publishAt's minute. */
  slots: DistributedSlot[];
  /** The slot's wall-clock "HH:MM" in the timezone, for the schedule row. */
  time: string;
}

const MINUTE_MS = 60_000;

export function resolvePublishAtSlot(
  publishAt: string,
  timezone: string,
  route: string,
): PublishAtSlot | NextResponse {
  if (!isValidTimezone(timezone)) {
    return apiErrorResponse(400, `Invalid timezone: "${timezone}".`, {
      route,
      code: ERROR_CODES.VALIDATION_FAILED,
      field: 'publishing.schedule.timezone',
    });
  }
  const at = parseZonedDateTime(publishAt, timezone);
  if (at === null) {
    return apiErrorResponse(
      400,
      'publishing.schedule.publishAt must be an ISO datetime, e.g. "2026-12-01T20:00:00" (wall-clock in the timezone) or one with an offset.',
      { route, code: ERROR_CODES.VALIDATION_FAILED, field: 'publishing.schedule.publishAt' },
    );
  }
  const slotAt = new Date(Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS);
  const windowCheck = validateScheduleWindow(slotAt);
  if (!windowCheck.ok) {
    return apiErrorResponse(400, windowCheck.error, {
      route,
      code: ERROR_CODES.SCHEDULE_OUT_OF_RANGE,
      field: 'publishing.schedule.publishAt',
    });
  }
  // The timezone is valid and the instant is real, so the format never
  // returns null here; the guard keeps the type honest without a cast.
  const local = utcToZonedInputValue(slotAt.toISOString(), timezone);
  if (local === null) {
    return apiErrorResponse(400, `Invalid timezone: "${timezone}".`, {
      route,
      code: ERROR_CODES.VALIDATION_FAILED,
      field: 'publishing.schedule.timezone',
    });
  }
  return {
    slots: [{ slotAtISO: slotAt.toISOString(), dayIndex: 0, timeIndex: 0 }],
    time: local.slice(11, 16),
  };
}
