import { describe, it, expect } from 'vitest';
import { validateScheduleAdvance } from '../validator.js';

describe('Schedule Advance Validator (> 24h rule)', () => {
  it('should reject schedule times less than 24 hours in the future', () => {
    const now = new Date('2026-09-18T09:00:00.000Z');
    
    // 10 hours later (same day 19:00)
    const tooSoonSameDay = new Date('2026-09-18T19:00:00.000Z');
    const resultSameDay = validateScheduleAdvance(tooSoonSameDay, now);
    expect(resultSameDay.isValid).toBe(false);
    expect(resultSameDay.error).toMatch(/at least 24 hours/i);

    // 23 hours and 59 minutes later (tomorrow 08:59)
    const tooSoonTomorrow = new Date('2026-09-19T08:59:00.000Z');
    const resultTomorrow = validateScheduleAdvance(tooSoonTomorrow, now);
    expect(resultTomorrow.isValid).toBe(false);
    expect(resultTomorrow.error).toMatch(/at least 24 hours/i);
    expect(resultTomorrow.error).not.toMatch(/batch/i);
  });

  it('should reject schedule times exactly at current time or in the past', () => {
    const now = new Date('2026-09-18T09:00:00.000Z');
    const past = new Date('2026-09-17T09:00:00.000Z');

    expect(validateScheduleAdvance(now, now).isValid).toBe(false);
    expect(validateScheduleAdvance(past, now).isValid).toBe(false);
  });

  it('should accept schedule times at least 24 hours in the future', () => {
    const now = new Date('2026-09-18T09:00:00.000Z');

    // Exactly 24 hours later (tomorrow 09:00)
    const exactly24h = new Date('2026-09-19T09:00:00.000Z');
    const result24h = validateScheduleAdvance(exactly24h, now);
    expect(result24h.isValid).toBe(true);
    expect(result24h.error).toBeUndefined();

    // 48 hours later
    const future48h = new Date('2026-09-20T09:00:00.000Z');
    const result48h = validateScheduleAdvance(future48h, now);
    expect(result48h.isValid).toBe(true);
  });

  it('should validate ISO string inputs', () => {
    const now = new Date('2026-09-18T09:00:00.000Z');
    const validIso = '2026-09-20T12:00:00.000Z';
    const invalidIso = '2026-09-18T15:00:00.000Z';

    expect(validateScheduleAdvance(validIso, now).isValid).toBe(true);
    expect(validateScheduleAdvance(invalidIso, now).isValid).toBe(false);
    expect(validateScheduleAdvance('invalid-date-format', now).isValid).toBe(false);
  });

  it('should reject schedule times more than 30 days in the future', () => {
    const now = new Date('2026-09-18T09:00:00.000Z');

    // Exactly 30 days later — allowed
    const exactly30d = new Date('2026-10-18T09:00:00.000Z');
    expect(validateScheduleAdvance(exactly30d, now).isValid).toBe(true);

    // 31 days later — rejected
    const tooFar31d = new Date('2026-10-19T09:00:00.000Z');
    const result31d = validateScheduleAdvance(tooFar31d, now);
    expect(result31d.isValid).toBe(false);
    expect(result31d.error).toMatch(/30 days in advance/i);
  });
});
