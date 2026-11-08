import { describe, it, expect } from 'vitest';
import { parseRange, RANGE_MAX_SPAN_DAYS } from '../range';

const q = (s: string) => new URLSearchParams(s);

describe('parseRange', () => {
  it('is not range mode without from/to', () => {
    expect(parseRange(q(''))).toEqual({ kind: 'none' });
    expect(parseRange(q('limit=5'))).toEqual({ kind: 'none' });
  });

  it('normalizes a valid range to UTC ISO instants', () => {
    expect(parseRange(q('from=2026-11-01T00:00:00-03:00&to=2026-12-01T00:00:00-03:00'))).toEqual({
      kind: 'range',
      from: '2026-11-01T03:00:00.000Z',
      to: '2026-12-01T03:00:00.000Z',
    });
  });

  it.each([
    ['from only', 'from=2026-11-01T00:00:00Z'],
    ['to only', 'to=2026-11-01T00:00:00Z'],
  ])('rejects %s', (_name, query) => {
    expect(parseRange(q(query))).toMatchObject({ kind: 'error' });
  });

  it.each([
    ['a date without time', 'from=2026-11-01&to=2026-12-01'],
    ['a timestamp without offset', 'from=2026-11-01T00:00:00&to=2026-12-01T00:00:00'],
    ['garbage', 'from=abc&to=def'],
    ['an impossible date', 'from=2026-13-45T00:00:00Z&to=2026-14-01T00:00:00Z'],
  ])('rejects %s', (_name, query) => {
    expect(parseRange(q(query))).toMatchObject({ kind: 'error' });
  });

  it('rejects an empty or inverted range', () => {
    expect(parseRange(q('from=2026-11-01T00:00:00Z&to=2026-11-01T00:00:00Z'))).toMatchObject({ kind: 'error' });
    expect(parseRange(q('from=2026-12-01T00:00:00Z&to=2026-11-01T00:00:00Z'))).toMatchObject({ kind: 'error' });
  });

  it('rejects combining a range with limit', () => {
    expect(parseRange(q('from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z&limit=5'))).toMatchObject({ kind: 'error' });
  });

  it('accepts exactly the max span and rejects one day more', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const at = (days: number) => new Date(from.getTime() + days * 86_400_000).toISOString();
    expect(parseRange(q(`from=${from.toISOString()}&to=${at(RANGE_MAX_SPAN_DAYS)}`)).kind).toBe('range');
    expect(parseRange(q(`from=${from.toISOString()}&to=${at(RANGE_MAX_SPAN_DAYS + 1)}`)).kind).toBe('error');
  });
});
