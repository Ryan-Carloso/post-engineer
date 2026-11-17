//---------------
// metrics-query — the GET /api/metrics helpers shared by the route and
// the dashboard. The wire contract (query parsing, row/coverage views,
// response envelope) lives in shared/contracts/metrics.ts and is
// re-exported here so existing import paths keep working; only the
// derivation helpers that are not wire validation stay in this file.
//
// Filters are optional and exact-match. METRICS_NONE selects the rows
// whose persona / angle is null (faceless posts, posts without an angle).
//---------------

export {
  ANALYTICS_STATUSES,
  COVERAGE_REASONS,
  METRICS_FILTER_MAX_LENGTH,
  METRICS_NONE,
  UUID,
  isAnalyticsStatus,
  isCoverageReason,
  isMetricsWindow,
  metricsSearchParams,
  parseMetricsQuery,
  parseRetentionCurveQuery,
} from '@/lib/contracts/metrics';
export type {
  AnalyticsStatus,
  CoverageItem,
  CoverageReason,
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

// Window start hours after publish (migrations 025/039: the due SQL's
// `values ('24h', 24), ('7d', 168), ('28d', 672)` — pinned against the SQL
// by the sync test in lib/metrics/__tests__/metrics-coverage.test.ts).
export const METRICS_WINDOW_START_HOURS: Record<MetricsWindow, number> = { '24h': 24, '7d': 168, '28d': 672 };
// Every window is 24h wide (migration 025: start_hours + 24).
export const METRICS_WINDOW_WIDTH_HOURS = 24;
// The oldest publish a coverage/re-open scan can still act on: the 28d
// window closes 672 + 24 hours after publish.
export const METRICS_WINDOW_LOOKBACK_HOURS =
  Math.max(...Object.values(METRICS_WINDOW_START_HOURS)) + METRICS_WINDOW_WIDTH_HOURS;

//---------------
// metricsWindowRange — [opensAt, closesAt) for one window of a post
// published at publishedAt. Mirrors the due SQL's bounds exactly:
// published_at <= now - start_hours and published_at > now - (start_hours + 24).
//---------------
export function metricsWindowRange(
  window: MetricsWindow,
  publishedAt: Date,
): { opensAt: Date; closesAt: Date } {
  const opensAt = new Date(publishedAt.getTime() + METRICS_WINDOW_START_HOURS[window] * 60 * 60 * 1000);
  const closesAt = new Date(opensAt.getTime() + METRICS_WINDOW_WIDTH_HOURS * 60 * 60 * 1000);
  return { opensAt, closesAt };
}

// YouTube Analytics data is provisional for ~48-72h: a snapshot whose range
// ends within this many days of its collection may still change.
export const ANALYTICS_PROVISIONAL_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

//---------------
// stayedToWatchPct — DERIVED, not a native API metric: engaged views /
// views * 100, one decimal. Null when either is unknown or views is 0
// (no views is "no signal", never 0%).
//---------------
export function stayedToWatchPct(engagedViews: number | null, views: number | null): number | null {
  if (engagedViews === null || views === null || views === 0) return null;
  return Math.round((engagedViews / views) * 1000) / 10;
}

// Postgres numeric arrives from PostgREST as a number or a decimal string.
export function numericOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

//---------------
// isProvisional — the Analytics range ends less than
// ANALYTICS_PROVISIONAL_DAYS before the snapshot was collected. The '28d'
// window queries up to collection - 3 days, so its rows are final.
//---------------
export function isProvisional(endDate: string | null, collectedAt: string): boolean {
  if (endDate === null) return false;
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const collected = Date.parse(`${collectedAt.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(end) || Number.isNaN(collected)) return false;
  return end > collected - ANALYTICS_PROVISIONAL_DAYS * DAY_MS;
}
