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

export interface MetricsSummary {
  measurements: number;
  views: number;
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

function parseCoverageItem(value: unknown): CoverageItem | null {
  if (typeof value !== 'object' || value === null) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.postId !== 'string'
    || (typeof item.personaId !== 'string' && item.personaId !== null)
    || !isSocialProvider(item.provider)
    || typeof item.accountId !== 'string'
    || (typeof item.externalId !== 'string' && item.externalId !== null)
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

export async function fetchMetrics(query: MetricsQuery): Promise<MetricsFetchResult> {
  try {
    const response = await fetch(`/api/metrics?${metricsSearchParams(query).toString()}`);
    if (!response.ok) {
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
    queryKey: ['metrics', query.window, query.personaId, query.accountId, query.provider],
    queryFn: () => fetchMetrics(query),
    staleTime: 60_000,
  });
}

export function summarize(rows: MetricsRowView[]): MetricsSummary {
  let views = 0;
  let engagement = 0;
  for (const row of rows) {
    if (row.views !== null) views += row.views;
    if (row.likes !== null) engagement += row.likes;
    if (row.comments !== null) engagement += row.comments;
    if (row.saves !== null) engagement += row.saves;
  }
  return { measurements: rows.length, views, engagement };
}

export function sortByViews(rows: MetricsRowView[]): MetricsRowView[] {
  return [...rows].sort((a, b) => {
    if (a.views === null && b.views === null) return b.collectedAt.localeCompare(a.collectedAt);
    if (a.views === null) return 1;
    if (b.views === null) return -1;
    return b.views - a.views || b.collectedAt.localeCompare(a.collectedAt);
  });
}

interface RetentionCurvePoint {
  ratio: number;
  audienceWatchRatio: number;
  relativeRetentionPerformance: number | null;
}

export type RetentionCurveSuccess = { success: true; points: RetentionCurvePoint[]; provisional: boolean };

type RetentionCurveFetchResult =
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

async function fetchRetentionCurve(accountId: string, videoId: string): Promise<RetentionCurveFetchResult> {
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
    queryFn: async () => {
      const result = await fetchRetentionCurve(accountId, videoId);
      if (!result.success) throw new RetentionCurveFetchError(result.error, result.reconnect);
      return result;
    },
    enabled,
    retry: false,
    staleTime: 10 * 60_000,
  });
}
