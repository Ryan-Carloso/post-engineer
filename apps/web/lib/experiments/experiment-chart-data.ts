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

export function isChartMetric(value: string): value is ExperimentChartMetric {
  return EXPERIMENT_CHART_METRICS.some((option) => option === value);
}

export function variantTooltipName(name: string | number, firstName: string, secondName: string): string {
  return name === 'a' ? firstName : secondName;
}

export function winSplitTooltipName(name: string | number, firstName: string, secondName: string, tieLabel: string): string {
  return name === 'a' ? firstName : name === 'b' ? secondName : tieLabel;
}

export interface VariantMetricTotals {
  variantId: string;
  total: number | null;
  excludedNulls: number;
  includedPairs: number;
}

export function excludedNullPairs(
  comparisons: ExperimentPairComparison[],
  firstId: string,
  secondId: string,
  metric: ExperimentChartMetric,
): number {
  let count = 0;
  for (const comparison of comparisons) {
    const first = comparison.values[firstId]?.[metric] ?? null;
    const second = comparison.values[secondId]?.[metric] ?? null;
    if (first === null || second === null) {
      count += 1;
    }
  }
  return count;
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
  const total = includedPairs === 0
    ? null
    : metric === 'averageViewDurationSeconds'
      ? sum / includedPairs
      : sum;
  return { variantId, total, excludedNulls, includedPairs };
}

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
