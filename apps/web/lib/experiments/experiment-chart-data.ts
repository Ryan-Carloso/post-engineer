import type {
  ExperimentPairComparison,
  ExperimentProviderResult,
} from './experiments-dashboard';

export type ExperimentChartMetric = 'views' | 'likes' | 'comments' | 'averageViewDurationSeconds';

export const EXPERIMENT_CHART_METRICS: readonly ExperimentChartMetric[] = [
  'views',
  'likes',
  'comments',
  'averageViewDurationSeconds',
];

export interface VariantMetricTotals {
  variantId: string;
  total: number;
  excludedNulls: number;
  includedPairs: number;
}

export interface WinSplit {
  winsA: number;
  ties: number;
  winsB: number;
}

export interface PairChartRow {
  pair: number;
  a: number | null;
  b: number | null;
  winner: string | null;
}

/**
 * Sums a metric across pairs for one variant. A null is excluded, never
 * counted as 0, and reported in `excludedNulls` so the caption can state
 * it. Average view duration is the mean of the non-null values; when
 * there are none the total is null (no bar) rather than 0.
 */
export function variantMetricTotals(
  comparisons: ExperimentPairComparison[],
  variantId: string,
  metric: ExperimentChartMetric,
): VariantMetricTotals {
  let sum = 0;
  let excludedNulls = 0;
  let includedPairs = 0;
  for (const comparison of comparisons) {
    const cell = comparison.values[variantId];
    const value = cell === undefined ? null : cell[metric];
    if (value === null || value === undefined) {
      excludedNulls += 1;
      continue;
    }
    sum += value;
    includedPairs += 1;
  }
  // No non-null value at all: there is no total to draw (NaN), never 0.
  const total = includedPairs === 0
    ? Number.NaN
    : metric === 'averageViewDurationSeconds'
      ? sum / includedPairs
      : sum;
  return { variantId, total, excludedNulls, includedPairs };
}

/**
 * One row per pair, sorted by pair number, with the A/B values for the
 * chosen metric (null stays null, never 0).
 */
export function pairChartRows(
  comparisons: ExperimentPairComparison[],
  firstId: string,
  secondId: string,
  metric: ExperimentChartMetric,
): PairChartRow[] {
  return [...comparisons]
    .sort((a, b) => a.pair - b.pair)
    .map((comparison) => ({
      pair: comparison.pair,
      a: readMetric(comparison.values[firstId]?.[metric] ?? null),
      b: readMetric(comparison.values[secondId]?.[metric] ?? null),
      winner: comparison.winner,
    }));
}

/** Wins A · ties · wins B for a provider, in chart order. */
export function winSplit(
  provider: ExperimentProviderResult,
  firstId: string,
  secondId: string,
): WinSplit {
  return {
    winsA: provider.wins[firstId] ?? 0,
    ties: provider.ties,
    winsB: provider.wins[secondId] ?? 0,
  };
}

function readMetric(value: number | null | undefined): number | null {
  return value ?? null;
}
