import type { NextResponse } from 'next/server';
import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { validateScheduleWindow } from '@/lib/schedule-window';
import {
  distributeSlots,
  SlotDistributionError,
  type DistributedSlot,
} from '@/lib/schedule/slot-distribution';
import { validationFailed } from './prepare-persona';

export interface SlotFieldNames {
  times: string;
  timezone: string;
  startAt: string;
  window: string;
}

export const PUBLISHING_SCHEDULE_FIELDS: SlotFieldNames = {
  times: 'publishing.schedule.times',
  timezone: 'publishing.schedule.timezone',
  startAt: 'publishing.schedule.startAt',
  window: 'publishing.schedule',
};

export function validateSlots(
  startAt: string,
  times: string[],
  timezone: string,
  count: number,
  fields: SlotFieldNames = PUBLISHING_SCHEDULE_FIELDS,
): DistributedSlot[] | NextResponse {
  let slots: DistributedSlot[];
  try {
    slots = distributeSlots({ startAtISO: startAt, times, timezone, count });
  } catch (error) {
    if (error instanceof SlotDistributionError) {
      const field =
        error.field === 'times'
          ? fields.times
          : error.field === 'timezone'
            ? fields.timezone
            : error.field === 'startAt'
              ? fields.startAt
              : fields.window;
      const code = error.field === 'times' ? ERROR_CODES.INVALID_SCHEDULE_TIME : ERROR_CODES.VALIDATION_FAILED;
      const message =
        code === ERROR_CODES.INVALID_SCHEDULE_TIME ? formatErrorMessage(code) : error.message;
      return validationFailed(code, message, field);
    }
    throw error;
  }
  for (const slot of slots) {
    const windowCheck = validateScheduleWindow(new Date(slot.slotAtISO));
    if (!windowCheck.ok) {
      return validationFailed(
        ERROR_CODES.SCHEDULE_OUT_OF_RANGE,
        windowCheck.error,
        fields.window,
      );
    }
  }
  return slots;
}
