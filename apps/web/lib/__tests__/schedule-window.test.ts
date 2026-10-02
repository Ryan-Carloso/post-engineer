import { describe, it, expect } from 'vitest';
import {
  validateScheduleWindow,
  SCHEDULE_MIN_ADVANCE_HOURS,
  SCHEDULE_MAX_AHEAD_DAYS,
} from '../schedule-window';

describe('schedule-window validator (3h min / 30d max)', () => {
  it('exposes the expected window constants', () => {
    expect(SCHEDULE_MIN_ADVANCE_HOURS).toBe(3);
    expect(SCHEDULE_MAX_AHEAD_DAYS).toBe(30);
  });

  it('rejects datetimes less than 3 hours in the future', () => {
    const now = new Date('2026-09-18T09:00:00.000Z');

    const tooSoon = validateScheduleWindow('2026-09-18T11:00:00.000Z', now);
    expect(tooSoon.ok).toBe(false);
    if (!tooSoon.ok) expect(tooSoon.error).toMatch(/at least 3 hours/i);

    const past = validateScheduleWindow('2026-09-17T09:00:00.000Z', now);
    expect(past.ok).toBe(false);
  });

  it('accepts a datetime exactly 3 hours in the future (boundary)', () => {
    const now = new Date('2026-09-18T09:00:00.000Z');

    expect(validateScheduleWindow('2026-09-18T12:00:00.000Z', now).ok).toBe(true);
  });

  it('rejects datetimes more than 30 days in the future', () => {
    const now = new Date('2026-09-18T09:00:00.000Z');

    const tooFar = validateScheduleWindow('2026-10-19T09:00:00.000Z', now);
    expect(tooFar.ok).toBe(false);
    if (!tooFar.ok) expect(tooFar.error).toMatch(/more than 30 days/i);
  });

  it('accepts datetimes inside the 3h..30d window', () => {
    const now = new Date('2026-09-18T09:00:00.000Z');

    expect(validateScheduleWindow('2026-09-18T12:00:00.000Z', now).ok).toBe(true);
    expect(validateScheduleWindow('2026-09-19T09:00:00.000Z', now).ok).toBe(true);
    expect(validateScheduleWindow('2026-10-18T09:00:00.000Z', now).ok).toBe(true);
  });

  it('rejects invalid date formats', () => {
    const now = new Date('2026-09-18T09:00:00.000Z');

    expect(validateScheduleWindow('not-a-date', now).ok).toBe(false);
    expect(validateScheduleWindow('', now).ok).toBe(false);
    expect(validateScheduleWindow(12345, now).ok).toBe(false);
  });

  it('accepts Date instances as well as ISO strings', () => {
    const now = new Date('2026-09-18T09:00:00.000Z');

    expect(validateScheduleWindow(new Date('2026-09-25T09:00:00.000Z'), now).ok).toBe(true);
  });
});
