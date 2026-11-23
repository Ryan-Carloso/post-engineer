export {
  ANALYTICS_STATUSES,
  COVERAGE_REASONS,
  METRICS_FILTER_MAX_LENGTH,
  METRICS_NONE,
  UUID,
  isAnalyticsStatus,
  isCoverageReason,
  isMetricsWindow,
  last24hSearchParams,
  metricsSearchParams,
  parseLast24hQuery,
  parseMetricsQuery,
  parseRetentionCurveQuery,
} from '@/lib/contracts/metrics';
export type {
  AnalyticsStatus,
  CoverageItem,
  CoverageReason,
  Last24hQuery,
  Last24hResponse,
  Last24hRowView,
  MetricsQuery,
  MetricsResponse,
  MetricsRowView,
  RetentionCurveResponse,
  RetentionPoint,
} from '@/lib/contracts/metrics';
export type { SocialProvider } from '@/lib/contracts/providers';

export const METRICS_ROW_LIMIT = 500;

export const METRICS_WINDOWS = ['24h', '7d', '28d'] as const;
export type MetricsWindow = (typeof METRICS_WINDOWS)[number];

export const METRICS_WINDOW_START_HOURS: Record<MetricsWindow, number> = { '24h': 24, '7d': 168, '28d': 672 };
export const METRICS_WINDOW_WIDTH_HOURS = 24;
export const METRICS_WINDOW_LOOKBACK_HOURS =
  Math.max(...Object.values(METRICS_WINDOW_START_HOURS)) + METRICS_WINDOW_WIDTH_HOURS;

export function metricsWindowRange(
  window: MetricsWindow,
  publishedAt: Date,
): { opensAt: Date; closesAt: Date } {
  const opensAt = new Date(publishedAt.getTime() + METRICS_WINDOW_START_HOURS[window] * 60 * 60 * 1000);
  const closesAt = new Date(opensAt.getTime() + METRICS_WINDOW_WIDTH_HOURS * 60 * 60 * 1000);
  return { opensAt, closesAt };
}

export const ANALYTICS_PROVISIONAL_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export function stayedToWatchPct(engagedViews: number | null, views: number | null): number | null {
  if (engagedViews === null || views === null || views === 0) return null;
  return Math.round((engagedViews / views) * 1000) / 10;
}

export function numericOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function isProvisional(endDate: string | null, collectedAt: string): boolean {
  if (endDate === null) return false;
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const collected = Date.parse(`${collectedAt.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(end) || Number.isNaN(collected)) return false;
  return end > collected - ANALYTICS_PROVISIONAL_DAYS * DAY_MS;
}
