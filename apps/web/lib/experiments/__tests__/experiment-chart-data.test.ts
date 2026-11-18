import { describe, expect, it } from 'vitest';

import {
  excludedNullPairs,
  isChartMetric,
  pairChartRows,
  variantMetricTotals,
  variantTooltipName,
  winSplit,
  winSplitTooltipName,
} from '../experiment-chart-data';
import type {
  ExperimentPairComparison,
  ExperimentProviderResult,
} from '../experiments-dashboard';

const A = 'hook-calm';
const B = 'hook-aggressive';

function cell(views: number | null, likes: number | null, comments: number | null, averageViewDurationSeconds: number | null) {
  return { views, likes, comments, averageViewDurationSeconds };
}

const COMPARISONS: ExperimentPairComparison[] = [
  {
    pair: 2,
    values: {
      [A]: cell(300, null, 1, 10),
      [B]: cell(100, 1, 0, null),
    },
    winner: A,
  },
  {
    pair: 1,
    values: {
      [A]: cell(500, 2, null, 12),
      [B]: cell(250, 1, 2, 20),
    },
    winner: A,
  },
  {
    pair: 3,
    values: {
      [A]: cell(null, 1, 1, null),
      [B]: cell(null, 0, 0, 8),
    },
    winner: null,
  },
];

function provider(overrides: Partial<ExperimentProviderResult> = {}): ExperimentProviderResult {
  return {
    provider: 'youtube',
    comparisons: COMPARISONS,
    wins: { [A]: 2, [B]: 1 },
    ties: 1,
    pValue: 0.25,
    leader: A,
    label: 'indicative',
    ...overrides,
  };
}

describe('variantMetricTotals', () => {
  it('sums non-null views and counts the excluded nulls', () => {
    expect(variantMetricTotals(COMPARISONS, A, 'views')).toEqual({
      variantId: A,
      total: 800,
      excludedNulls: 1,
      includedPairs: 2,
    });
    expect(variantMetricTotals(COMPARISONS, B, 'views')).toEqual({
      variantId: B,
      total: 350,
      excludedNulls: 1,
      includedPairs: 2,
    });
  });

  it('averages non-null view duration, never drawing nulls as 0', () => {
    // A: (10 + 12) / 2 = 11, one null excluded; B: 20 / 1.
    expect(variantMetricTotals(COMPARISONS, A, 'averageViewDurationSeconds').total).toBe(11);
    expect(variantMetricTotals(COMPARISONS, B, 'averageViewDurationSeconds').total).toBe(14);
  });

  it('returns null when there is no non-null value at all', () => {
    const allNull: ExperimentPairComparison[] = [
      { pair: 1, values: { [A]: cell(null, null, null, null), [B]: cell(null, null, null, null) }, winner: null },
    ];
    for (const metric of ['views', 'likes', 'comments', 'averageViewDurationSeconds'] as const) {
      const result = variantMetricTotals(allNull, A, metric);
      expect(result.total).toBeNull();
      expect(result.includedPairs).toBe(0);
      expect(result.excludedNulls).toBe(1);
    }
  });

  it('keeps a real 0 total: zero comments included are not excluded', () => {
    expect(variantMetricTotals(COMPARISONS, B, 'comments')).toEqual({
      variantId: B,
      total: 2,
      excludedNulls: 0,
      includedPairs: 3,
    });
  });

  it('counts a missing variant cell as excluded', () => {
    const missing: ExperimentPairComparison[] = [
      { pair: 1, values: { [A]: cell(10, 1, 1, 5) }, winner: null },
    ];
    expect(variantMetricTotals(missing, B, 'views')).toEqual({
      variantId: B,
      total: null,
      excludedNulls: 1,
      includedPairs: 0,
    });
  });
});

describe('excludedNullPairs', () => {
  it('counts a pair with both values missing once, not twice', () => {
    const comparisons: ExperimentPairComparison[] = [
      { pair: 1, values: { [A]: cell(null, 1, 0, 5), [B]: cell(null, 1, 0, 5) }, winner: null },
      { pair: 2, values: { [A]: cell(100, 1, 0, 5), [B]: cell(50, 1, 0, 5) }, winner: A },
    ];
    expect(excludedNullPairs(comparisons, A, B, 'views')).toBe(1);
  });

  it('counts each missing pair once when missing values are spread', () => {
    const comparisons: ExperimentPairComparison[] = [
      { pair: 1, values: { [A]: cell(null, 1, 0, 5), [B]: cell(10, 1, 0, 5) }, winner: null },
      { pair: 2, values: { [A]: cell(100, 1, 0, 5), [B]: cell(null, 1, 0, 5) }, winner: null },
      { pair: 3, values: { [A]: cell(100, 1, 0, 5), [B]: cell(50, 1, 0, 5) }, winner: A },
    ];
    expect(excludedNullPairs(comparisons, A, B, 'views')).toBe(2);
  });

  it('counts a missing variant cell as an excluded pair', () => {
    const missing: ExperimentPairComparison[] = [
      { pair: 1, values: { [A]: cell(10, 1, 1, 5) }, winner: null },
    ];
    expect(excludedNullPairs(missing, A, B, 'views')).toBe(1);
  });
});

describe('pairChartRows', () => {
  it('sorts by pair and keeps nulls as null', () => {
    expect(pairChartRows(COMPARISONS, A, B, 'views')).toEqual([
      { pair: 1, a: 500, b: 250, winner: A },
      { pair: 2, a: 300, b: 100, winner: A },
      { pair: 3, a: null, b: null, winner: null },
    ]);
  });

  it('reads the chosen metric only', () => {
    expect(pairChartRows(COMPARISONS, A, B, 'likes')).toEqual([
      { pair: 1, a: 2, b: 1, winner: A },
      { pair: 2, a: null, b: 1, winner: A },
      { pair: 3, a: 1, b: 0, winner: null },
    ]);
  });
});

describe('isChartMetric', () => {
  it('accepts each of the four chart metrics', () => {
    for (const metric of ['views', 'likes', 'comments', 'averageViewDurationSeconds']) {
      expect(isChartMetric(metric)).toBe(true);
    }
  });

  it('rejects anything else, including the empty string', () => {
    expect(isChartMetric('bogus')).toBe(false);
    expect(isChartMetric('')).toBe(false);
    expect(isChartMetric('Views')).toBe(false);
  });
});

describe('tooltip names', () => {
  it('maps series keys to variant names', () => {
    expect(variantTooltipName('a', 'First', 'Second')).toBe('First');
    expect(variantTooltipName('b', 'First', 'Second')).toBe('Second');
    expect(variantTooltipName('other', 'First', 'Second')).toBe('Second');
  });

  it('maps the win-split tie key to the tie label', () => {
    expect(winSplitTooltipName('a', 'First', 'Second', 'Tie')).toBe('First');
    expect(winSplitTooltipName('b', 'First', 'Second', 'Tie')).toBe('Second');
    expect(winSplitTooltipName('ties', 'First', 'Second', 'Tie')).toBe('Tie');
    expect(winSplitTooltipName('other', 'First', 'Second', 'Tie')).toBe('Tie');
  });
});

describe('winSplit', () => {
  it('returns wins A, ties and wins B in chart order', () => {
    expect(winSplit(provider(), A, B)).toEqual({ winsA: 2, ties: 1, winsB: 1 });
  });

  it('counts a missing variant as zero wins', () => {
    expect(winSplit(provider({ wins: { [A]: 3 } }), A, B)).toEqual({ winsA: 3, ties: 1, winsB: 0 });
  });
});
