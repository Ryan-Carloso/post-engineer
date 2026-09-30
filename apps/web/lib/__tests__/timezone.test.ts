import { describe, it, expect } from 'vitest';
import {
  hasExplicitOffset,
  isValidTimezone,
  parseNaiveDateTime,
  parseZonedDateTime,
  zonedTimeToUtc,
} from '../timezone';

describe('isValidTimezone', () => {
  it('accepts real IANA zones', () => {
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimezone('Europe/Lisbon')).toBe(true);
  });

  it('rejects garbage', () => {
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isValidTimezone('UTC+3')).toBe(false);
  });
});

describe('hasExplicitOffset', () => {
  it('detects Zulu and numeric offsets', () => {
    expect(hasExplicitOffset('2026-10-01T14:00:00Z')).toBe(true);
    expect(hasExplicitOffset('2026-10-01T14:00:00+01:00')).toBe(true);
    expect(hasExplicitOffset('2026-10-01T14:00:00-0300')).toBe(true);
  });

  it('rejects naive datetimes', () => {
    expect(hasExplicitOffset('2026-10-01T14:00:00')).toBe(false);
    expect(hasExplicitOffset('2026-10-01')).toBe(false);
  });
});

describe('parseNaiveDateTime', () => {
  it('parses a full naive datetime', () => {
    expect(parseNaiveDateTime('2026-10-01T14:00:00')).toEqual({
      year: 2026, month: 10, day: 1, hour: 14, minute: 0, second: 0,
    });
  });

  it('parses without seconds', () => {
    expect(parseNaiveDateTime('2026-10-01T14:00')).toEqual({
      year: 2026, month: 10, day: 1, hour: 14, minute: 0, second: 0,
    });
  });

  it('rejects out-of-range components', () => {
    expect(parseNaiveDateTime('2026-13-01T14:00:00')).toBeNull();
    expect(parseNaiveDateTime('2026-10-01T24:00:00')).toBeNull();
    expect(parseNaiveDateTime('2026-10-01T14:60:00')).toBeNull();
  });

  it('rejects non-datetime strings', () => {
    expect(parseNaiveDateTime('tomorrow')).toBeNull();
    expect(parseNaiveDateTime('2026-10-01T14:00:00Z')).toBeNull();
    expect(parseNaiveDateTime('')).toBeNull();
  });
});

describe('zonedTimeToUtc', () => {
  it('converts a summer Lisbon wall clock (WEST = UTC+1)', () => {
    // 2026-10-01 14:00 in Europe/Lisbon is 13:00 UTC.
    expect(zonedTimeToUtc(2026, 10, 1, 14, 0, 'Europe/Lisbon').toISOString())
      .toBe('2026-10-01T13:00:00.000Z');
  });

  it('converts a winter Lisbon wall clock (WET = UTC+0)', () => {
    // 2026-01-15 14:00 in Europe/Lisbon is 14:00 UTC.
    expect(zonedTimeToUtc(2026, 1, 15, 14, 0, 'Europe/Lisbon').toISOString())
      .toBe('2026-01-15T14:00:00.000Z');
  });

  it('handles a negative-offset zone', () => {
    // 2026-09-25 09:00 in America/Sao_Paulo (UTC-3) is 12:00 UTC.
    expect(zonedTimeToUtc(2026, 9, 25, 9, 0, 'America/Sao_Paulo').toISOString())
      .toBe('2026-09-25T12:00:00.000Z');
  });

  it('converges across a DST transition (spring forward gap)', () => {
    // 2026-03-29 02:30 does not exist in Europe/Lisbon (clocks jump
    // 01:00 -> 03:00 local); the fixed-point iteration must still settle
    // on a finite instant instead of NaN.
    const result = zonedTimeToUtc(2026, 3, 29, 2, 30, 'Europe/Lisbon');
    expect(Number.isNaN(result.getTime())).toBe(false);
  });
});

describe('parseZonedDateTime', () => {
  it('interprets a naive datetime in the given timezone', () => {
    const result = parseZonedDateTime('2026-10-01T14:00:00', 'Europe/Lisbon');
    expect(result?.toISOString()).toBe('2026-10-01T13:00:00.000Z');
  });

  it('respects an explicit offset as-is, ignoring the timezone argument', () => {
    const result = parseZonedDateTime('2026-10-01T14:00:00+01:00', 'America/Sao_Paulo');
    expect(result?.toISOString()).toBe('2026-10-01T13:00:00.000Z');
  });

  it('respects a Zulu instant as-is', () => {
    const result = parseZonedDateTime('2026-10-01T14:00:00Z', 'Europe/Lisbon');
    expect(result?.toISOString()).toBe('2026-10-01T14:00:00.000Z');
  });

  it('returns null for garbage', () => {
    expect(parseZonedDateTime('not-a-date', 'Europe/Lisbon')).toBeNull();
    expect(parseZonedDateTime('', 'Europe/Lisbon')).toBeNull();
    expect(parseZonedDateTime(null, 'Europe/Lisbon')).toBeNull();
    expect(parseZonedDateTime(123, 'Europe/Lisbon')).toBeNull();
  });
});
