export const MIN_SCHEDULE_ADVANCE_HOURS = 24;
export const MIN_SCHEDULE_ADVANCE_MS = MIN_SCHEDULE_ADVANCE_HOURS * 60 * 60 * 1000;

export const MAX_SCHEDULE_AHEAD_DAYS = 30;
export const MAX_SCHEDULE_AHEAD_MS = MAX_SCHEDULE_AHEAD_DAYS * 24 * 60 * 60 * 1000;

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

export function validateScheduleAdvance(
  target: Date | string,
  now: Date = new Date()
): ValidationResult {
  const targetDate = typeof target === 'string' ? new Date(target) : target;

  if (Number.isNaN(targetDate.getTime())) {
    return {
      isValid: false,
      error: 'Invalid date format provided for scheduling.',
    };
  }

  const diffMs = targetDate.getTime() - now.getTime();

  if (diffMs < MIN_SCHEDULE_ADVANCE_MS) {
    return {
      isValid: false,
      error: `Scheduled time must be at least 24 hours in advance (requested ${targetDate.toISOString()}, earliest allowed is ${new Date(
        now.getTime() + MIN_SCHEDULE_ADVANCE_MS
      ).toISOString()}).`,
    };
  }

  if (diffMs > MAX_SCHEDULE_AHEAD_MS) {
    return {
      isValid: false,
      error: `Scheduled time cannot be more than ${MAX_SCHEDULE_AHEAD_DAYS} days in advance (requested ${targetDate.toISOString()}, latest allowed is ${new Date(
        now.getTime() + MAX_SCHEDULE_AHEAD_MS
      ).toISOString()}).`,
    };
  }

  return { isValid: true };
}
