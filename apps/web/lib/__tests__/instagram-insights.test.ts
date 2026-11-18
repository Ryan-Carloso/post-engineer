import { describe, it, expect } from 'vitest';

import { parseInstagramInsightsPayload } from '@/lib/instagram-insights';

describe('parseInstagramInsightsPayload', () => {
  it('maps metric name to value from values[0] and total_value', () => {
    expect(
      parseInstagramInsightsPayload({
        data: [
          { name: 'views', values: [{ value: 1200 }] },
          { name: 'likes', total_value: { value: 80 } },
          { name: 'comments', values: [{ value: 7 }] },
          { name: 'saved', total_value: { value: 3 } },
        ],
      }),
    ).toEqual({ views: 1200, likes: 80, comments: 7, saved: 3 });
  });

  it('prefers values[0] when both shapes are present', () => {
    expect(
      parseInstagramInsightsPayload({
        data: [{ name: 'views', values: [{ value: 10 }], total_value: { value: 99 } }],
      }),
    ).toEqual({ views: 10 });
  });

  it('skips non-object items, missing names, and non-finite values', () => {
    expect(
      parseInstagramInsightsPayload({
        data: [
          null,
          'junk',
          { values: [{ value: 3 }] },
          { name: 'saved', values: [{ value: 'x' }] },
          { name: 'likes', values: [{ value: Number.NaN }] },
          { name: 'views', values: [{ value: Number.POSITIVE_INFINITY }] },
          { name: 'ok', values: [{ value: 5 }] },
        ],
      }),
    ).toEqual({ ok: 5 });
  });

  it('returns an empty map for a body without a data array', () => {
    expect(parseInstagramInsightsPayload({})).toEqual({});
    expect(parseInstagramInsightsPayload({ data: 'junk' })).toEqual({});
    expect(parseInstagramInsightsPayload(null)).toEqual({});
    expect(parseInstagramInsightsPayload('junk')).toEqual({});
  });
});
