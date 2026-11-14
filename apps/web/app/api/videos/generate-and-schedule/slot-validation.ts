//---------------
// Slot validation, extracted from route.ts so the route module stays
// under the file-size ratchet. All checks run BEFORE any token is charged.
//---------------

import type { NextResponse } from 'next/server';
import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { validateScheduleWindow } from '@/lib/schedule-window';
import {
  distributeSlots,
  SlotDistributionError,
  type DistributedSlot,
} from '@/lib/schedule/slot-distribution';
import { validationFailed } from './prepare-persona';

export function validateSlots(
  startAt: string,
  times: string[],
  timezone: string,
  count: number,
): DistributedSlot[] | NextResponse {
  let slots: DistributedSlot[];
  try {
    slots = distributeSlots({ startAtISO: startAt, times, timezone, count });
  } catch (error) {
    if (error instanceof SlotDistributionError) {
      const field =
        error.field === 'times'
          ? 'publishing.schedule.times'
          : error.field === 'timezone'
            ? 'publishing.schedule.timezone'
            : error.field === 'startAt'
              ? 'publishing.schedule.startAt'
              : 'publishing.schedule';
      const code = error.field === 'times' ? ERROR_CODES.INVALID_SCHEDULE_TIME : ERROR_CODES.VALIDATION_FAILED;
      const message =
        code === ERROR_CODES.INVALID_SCHEDULE_TIME ? formatErrorMessage(code) : error.message;
      return validationFailed(code, message, field);
    }
    throw error;
  }
  // Every slot must fall inside the 3h–30d publishing window.
  for (const slot of slots) {
    const windowCheck = validateScheduleWindow(new Date(slot.slotAtISO));
    if (!windowCheck.ok) {
      return validationFailed(
        ERROR_CODES.SCHEDULE_OUT_OF_RANGE,
        // windowCheck.error is the only copy for this code at this call
        // site: the validator always returns a non-empty message on the
        // failure branch, and it already interpolates the window constants.
        windowCheck.error,
        'publishing.schedule',
      );
    }
  }
  return slots;
}
