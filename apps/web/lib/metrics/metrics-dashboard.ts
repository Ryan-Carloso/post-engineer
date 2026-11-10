import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  isCoverageReason,
  metricsSearchParams,
  type CoverageItem,
  type MetricsQuery,
  type MetricsResponse,
  type MetricsRowView,
} from './metrics-query';
import { isSocialProvider } from '@/lib/providers/registry';
import { notifyIfSessionExpired } from '@/lib/session-expiry';

//---------------
// metrics-dashboard — client-side data for the metrics page: the React
// Query hook over GET /api/metrics, and the pure totals and sort that
// feed the video list.
//---------------

export interface MetricsSummary {
  // Rows in the list, whatever they reported.
  videos: number;
  // Sum of reported views; null values are skipped, never counted as 0.
  views: number;
  // Sum of reported likes + comments + saves; null values are skipped.
  engagement: number;
}

export type MetricsFetchResult =
  | { success: true; rows: MetricsRowView[]; truncated: boolean; coverage: CoverageItem[]; coverageTruncated: boolean; asOf: string | null }
  | { success: false; error: string };

function isMetricsResponse(value: unknown): value is MetricsResponse {
  return (
    typeof value === 'object'
    && value !== null
    && (value as { success?: unknown }).success === true
    && Array.isArray((value as { rows?: unknown }).rows)
    && typeof (value as { truncated?: unknown }).truncated === 'boolean'
  );
}

//---------------
// parseCoverage — lenient: a malformed item is dropped, never a reason
// to lose the rows. An older cached response without coverage reads as
// empty coverage with a null as-of.
//---------------
function parseCoverageItem(value: unknown): CoverageItem | null {
  if (typeof value !== 'object' || value === null) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.postId !== 'string'
    || (typeof item.personaId !== 'string' && item.personaId !== null)
    || !isSocialProvider(item.provider)
    || typeof item.accountId !== 'string'
    || (typeof item.externalId !== 'string' && item.externalId !== null)
    || (typeof item.scriptAngle !== 'string' && item.scriptAngle !== null)
    || !isCoverageReason(item.reason)
    || typeof item.publishedAt !== 'string'
    || typeof item.windowOpensAt !== 'string'
    || typeof item.windowClosesAt !== 'string'
  ) {
    return null;
  }
  return {
    postId: item.postId,
    personaId: item.personaId,
    provider: item.provider,
    accountId: item.accountId,
    externalId: item.externalId,
    scriptAngle: item.scriptAngle,
    reason: item.reason,
    publishedAt: item.publishedAt,
    windowOpensAt: item.windowOpensAt,
    windowClosesAt: item.windowClosesAt,
  };
}

function parseCoverage(body: unknown): {
  coverage: CoverageItem[];
  coverageTruncated: boolean;
  asOf: string | null;
} {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const raw = Array.isArray(record.coverage) ? record.coverage : [];
  const coverage = raw
    .map(parseCoverageItem)
    .filter((item): item is CoverageItem => item !== null);
  return {
    coverage,
    coverageTruncated: record.coverageTruncated === true,
    asOf: typeof record.asOf === 'string' ? record.asOf : null,
  };
}

//---------------
// fetchMetrics — never throws on HTTP errors: non-2xx, non-JSON (proxy
// HTML) and unexpected shapes come back as { success: false }.
//---------------
export async function fetchMetrics(query: MetricsQuery): Promise<MetricsFetchResult> {
  try {
    const response = await fetch(`/api/metrics?${metricsSearchParams(query).toString()}`);
    if (!response.ok) {
      // Fail-safe contract kept ({ success: false, error }), but a dead
      // session must still trigger the host-wide redirect.
      notifyIfSessionExpired(response);
      return { success: false, error: `status ${response.status}` };
    }
    const body: unknown = await response.json().catch(() => null);
    if (!isMetricsResponse(body)) return { success: false, error: 'unexpected response' };
    return { success: true, rows: body.rows, truncated: body.truncated, ...parseCoverage(body) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function useMetricsQuery(query: MetricsQuery): UseQueryResult<MetricsFetchResult, Error> {
  return useQuery<MetricsFetchResult, Error>({
    queryKey: ['metrics', query.window, query.personaId, query.accountId, query.provider, query.angle],
    queryFn: () => fetchMetrics(query),
    staleTime: 60_000,
  });
}

//---------------
// summarize — totals over the visible rows, no averages: a total can
// never read as a bug the way an average did (HabitLoom's 31 was the
// average of 248 views over 8 videos). Null values are skipped, never
// counted as 0.
//---------------
export function summarize(rows: MetricsRowView[]): MetricsSummary {
  let views = 0;
  let engagement = 0;
  for (const row of rows) {
    if (row.views !== null) views += row.views;
    if (row.likes !== null) engagement += row.likes;
    if (row.comments !== null) engagement += row.comments;
    if (row.saves !== null) engagement += row.saves;
  }
  return { videos: rows.length, views, engagement };
}

//---------------
// sortByViews — highest first for "which videos did best". Rows with no
// reported views go last; ties break on the newest collectedAt, so the
// order is deterministic. Returns a new array; the input is untouched.
//---------------
export function sortByViews(rows: MetricsRowView[]): MetricsRowView[] {
  return [...rows].sort((a, b) => {
    if (a.views === null && b.views === null) return b.collectedAt.localeCompare(a.collectedAt);
    if (a.views === null) return 1;
    if (b.views === null) return -1;
    return b.views - a.views || b.collectedAt.localeCompare(a.collectedAt);
  });
}

//---------------
// Retention curve (GET /api/metrics/retention-curve) — opened on demand
// per long-form YouTube video. Same never-throw contract as fetchMetrics;
// a reconnect code is surfaced so the page can show the reconnect prompt.
//---------------

export interface RetentionCurvePoint {
  ratio: number;
  audienceWatchRatio: number;
  relativeRetentionPerformance: number | null;
}

export type RetentionCurveSuccess = { success: true; points: RetentionCurvePoint[]; provisional: boolean };

export type RetentionCurveFetchResult =
  | RetentionCurveSuccess
  | { success: false; reconnect: boolean; error: string };

const RECONNECT_CODES = new Set(['YOUTUBE_ANALYTICS_SCOPE_MISSING', 'YOUTUBE_RECONNECT_REQUIRED']);

function isCurvePoint(value: unknown): value is RetentionCurvePoint {
  if (typeof value !== 'object' || value === null) return false;
  const point = value as Record<string, unknown>;
  return typeof point.ratio === 'number'
    && typeof point.audienceWatchRatio === 'number'
    && (point.relativeRetentionPerformance === null || typeof point.relativeRetentionPerformance === 'number');
}

export async function fetchRetentionCurve(accountId: string, videoId: string): Promise<RetentionCurveFetchResult> {
  try {
    const params = new URLSearchParams({ account: accountId, video: videoId });
    const response = await fetch(`/api/metrics/retention-curve?${params.toString()}`);
    const body: unknown = await response.json().catch(() => null);
    const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    if (!response.ok) {
      notifyIfSessionExpired(response);
      const code = typeof record.code === 'string' ? record.code : '';
      return { success: false, reconnect: RECONNECT_CODES.has(code), error: `status ${response.status}` };
    }
    const points = record.points;
    if (record.success !== true || !Array.isArray(points) || !points.every(isCurvePoint) || typeof record.provisional !== 'boolean') {
      return { success: false, reconnect: false, error: 'unexpected response' };
    }
    return { success: true, points, provisional: record.provisional };
  } catch (error) {
    return { success: false, reconnect: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export class RetentionCurveFetchError extends Error {
  readonly reconnect: boolean;

  constructor(message: string, reconnect: boolean) {
    super(message);
    this.name = 'RetentionCurveFetchError';
    this.reconnect = reconnect;
  }
}

export function useRetentionCurveQuery(
  accountId: string,
  videoId: string,
  enabled: boolean,
): UseQueryResult<RetentionCurveSuccess, RetentionCurveFetchError> {
  return useQuery<RetentionCurveSuccess, RetentionCurveFetchError>({
    queryKey: ['retention-curve', accountId, videoId],
    // A failed fetch becomes a query error, never successful cached data:
    // an errored query is stale, so closing and reopening the panel
    // refetches instead of serving the failure for staleTime.
    queryFn: async () => {
      const result = await fetchRetentionCurve(accountId, videoId);
      if (!result.success) throw new RetentionCurveFetchError(result.error, result.reconnect);
      return result;
    },
    enabled,
    // Reopening the panel is the retry; do not auto-retry a 4xx/5xx.
    retry: false,
    // A live Analytics read: keep a successful result for the session.
    staleTime: 10 * 60_000,
  });
}
