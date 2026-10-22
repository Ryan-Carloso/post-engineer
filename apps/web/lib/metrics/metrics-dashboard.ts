import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  METRICS_NONE,
  metricsSearchParams,
  type MetricsQuery,
  type MetricsResponse,
  type MetricsRowView,
} from './metrics-query';

//---------------
// metrics-dashboard — client-side data for the metrics page: the React
// Query hook over GET /api/metrics, the account labels, and the pure
// grouping that feeds the chart.
//---------------

export const METRIC_KEYS = ['views', 'likes', 'comments', 'saves'] as const;
export const GROUP_KEYS = ['angle', 'persona', 'account', 'provider'] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
export type GroupKey = (typeof GROUP_KEYS)[number];

export function isMetricKey(value: string): value is MetricKey {
  return (METRIC_KEYS as readonly string[]).includes(value);
}

export function isGroupKey(value: string): value is GroupKey {
  return (GROUP_KEYS as readonly string[]).includes(value);
}

export interface MetricsGroup {
  // Raw group value (persona id, account id, provider, angle) or
  // METRICS_NONE for rows without one.
  key: string;
  average: number;
  // Videos that reported the metric (rows with a null value are left out
  // of the average, never counted as 0).
  count: number;
}

export type MetricsFetchResult =
  | { success: true; rows: MetricsRowView[]; truncated: boolean }
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
// fetchMetrics — never throws on HTTP errors: non-2xx, non-JSON (proxy
// HTML) and unexpected shapes come back as { success: false }.
//---------------
export async function fetchMetrics(query: MetricsQuery): Promise<MetricsFetchResult> {
  try {
    const response = await fetch(`/api/metrics?${metricsSearchParams(query).toString()}`);
    if (!response.ok) return { success: false, error: `status ${response.status}` };
    const body: unknown = await response.json().catch(() => null);
    if (!isMetricsResponse(body)) return { success: false, error: 'unexpected response' };
    return { success: true, rows: body.rows, truncated: body.truncated };
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

function groupValue(row: MetricsRowView, group: GroupKey): string {
  if (group === 'persona') return row.personaId ?? METRICS_NONE;
  if (group === 'account') return row.accountId;
  if (group === 'provider') return row.provider;
  return row.scriptAngle ?? METRICS_NONE;
}

//---------------
// groupMetrics — average of one metric per group, highest first. Groups
// where no video reported the metric are omitted.
//---------------
export function groupMetrics(rows: MetricsRowView[], group: GroupKey, metric: MetricKey): MetricsGroup[] {
  const sums = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    const value = row[metric];
    if (value === null) continue;
    const key = groupValue(row, group);
    const entry = sums.get(key) ?? { total: 0, count: 0 };
    entry.total += value;
    entry.count += 1;
    sums.set(key, entry);
  }
  return [...sums.entries()]
    .map(([key, { total, count }]) => ({ key, average: Math.round(total / count), count }))
    .sort((a, b) => b.average - a.average || a.key.localeCompare(b.key));
}

//---------------
// distinctAngles — the angle filter's options, from the loaded rows.
//---------------
export function distinctAngles(rows: MetricsRowView[]): string[] {
  const angles = new Set<string>();
  for (const row of rows) if (row.scriptAngle !== null) angles.add(row.scriptAngle);
  return [...angles].sort((a, b) => a.localeCompare(b));
}
