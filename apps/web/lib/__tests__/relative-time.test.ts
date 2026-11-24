import { describe, expect, it } from 'vitest';
import { formatVersionDate } from '@/lib/relative-time';

const NOW = new Date('2026-11-24T12:00:00Z');

describe('formatVersionDate', () => {
  it.each([
    ['2026-11-24T11:59:40Z', 'en', 'now'],
    ['2026-11-24T11:30:00Z', 'en', '30 minutes ago'],
    ['2026-11-24T09:00:00Z', 'en', '3 hours ago'],
    ['2026-11-22T12:00:00Z', 'en', '2 days ago'],
    ['2026-11-24T09:00:00Z', 'pt', 'há 3 horas'],
    ['2026-11-22T12:00:00Z', 'pt', 'anteontem'],
    ['2026-11-20T12:00:00Z', 'pt', 'há 4 dias'],
  ] as const)('writes %s in %s as %s', (iso, locale, expected) => {
    expect(formatVersionDate(iso, locale, NOW)).toBe(expected);
  });

  it('writes an absolute date once it is more than 30 days old', () => {
    expect(formatVersionDate('2026-09-01T12:00:00Z', 'en', NOW)).toMatch(/Sep 1, 2026/);
    expect(formatVersionDate('2026-09-01T12:00:00Z', 'pt', NOW)).toMatch(/1 de set\. de 2026/);
  });

  it('writes the absolute date for a time in the future, never a negative span', () => {
    expect(formatVersionDate('2026-11-25T12:00:00Z', 'en', NOW)).toMatch(/Nov 25, 2026/);
  });

  it('returns the raw text for a date that does not parse', () => {
    expect(formatVersionDate('not a date', 'en', NOW)).toBe('not a date');
  });
});
