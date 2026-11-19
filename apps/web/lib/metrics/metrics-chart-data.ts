import type { MetricsRowView } from './metrics-query';

//---------------
// metrics-chart-data — pure aggregation behind the /metrics charts:
// every chart sums the rows the API returned (never re-fetches), skips
// null values instead of drawing them as 0, and says how many rows it
// skipped through the returned counts.
//---------------

export type ChartMetric = 'views' | 'engagement' | 'likes' | 'comments';

//---------------
// rowMetricValue — the number one row contributes to one chart metric.
// Null when the row reported nothing for that metric; engagement sums
// whichever of likes/comments/saves were reported and is null only when
// none of them was.
//---------------
export function rowMetricValue(row: MetricsRowView, metric: ChartMetric): number | null {
  if (metric === 'views') return row.views;
  if (metric === 'likes') return row.likes;
  if (metric === 'comments') return row.comments;
  if (row.likes === null && row.comments === null && row.saves === null) return null;
  return (row.likes ?? 0) + (row.comments ?? 0) + (row.saves ?? 0);
}

//---------------
// localDayKey — the calendar day ('YYYY-MM-DD') of one publish date in
// the viewer's time zone (or in `options.timeZone`, an IANA zone), or
// null when the date is missing/unparseable. Buckets are local days: a
// video published at 02:30 UTC lands on different days in São Paulo
// (-03) and in Berlin (+02).
//---------------
export function localDayKey(publishedAt: string, options: { timeZone?: string } = {}): string | null {
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: options.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: 'year' | 'month' | 'day'): string => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

// dayKeyToDate — the local Date at noon for a day key, so locale date
// formatting never shifts the day across a timezone boundary.
export function dayKeyToDate(day: string): Date {
  const [year, month, date] = day.split('-').map((part) => Number(part));
  return new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1, 12);
}

export interface OverTimePoint {
  day: string;
  value: number;
}

export interface OverTimeBuckets {
  points: OverTimePoint[];
  // Rows left out of the chart because their publish date is missing or
  // unparseable — never bucketed under the collection date instead.
  withoutPublishDate: number;
  // Rows left out because they reported no value for the chosen metric.
  withoutMetricValue: number;
}

//---------------
// bucketOverTime — total of one metric per publish day, oldest first.
// Days with no published video produce no point (never a 0 line).
//---------------
export function bucketOverTime(rows: MetricsRowView[], metric: ChartMetric): OverTimeBuckets {
  const totals = new Map<string, number>();
  let withoutPublishDate = 0;
  let withoutMetricValue = 0;
  for (const row of rows) {
    const day = localDayKey(row.publishedAt);
    if (day === null) {
      withoutPublishDate += 1;
      continue;
    }
    const value = rowMetricValue(row, metric);
    if (value === null) {
      withoutMetricValue += 1;
      continue;
    }
    totals.set(day, (totals.get(day) ?? 0) + value);
  }
  const points = [...totals.entries()]
    .map(([day, value]) => ({ day, value }))
    .sort((a, b) => a.day.localeCompare(b.day));
  return { points, withoutPublishDate, withoutMetricValue };
}

export type BreakdownGroup = 'provider' | 'persona';

export interface BreakdownItem {
  key: string;
  value: number;
}

//---------------
// breakdownBy — total views per network, or per persona. Null views are
// skipped (counted separately by countWithoutViews). Faceless rows group
// under 'faceless'. Sorted by views descending; ties break on the group
// key so the order is deterministic.
//---------------
export function breakdownBy(rows: MetricsRowView[], group: BreakdownGroup): BreakdownItem[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.views === null) continue;
    const key = group === 'provider' ? row.provider : (row.personaId ?? 'faceless');
    totals.set(key, (totals.get(key) ?? 0) + row.views);
  }
  return [...totals.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
}

// countWithoutViews — rows that reported no views, stated in the charts
// ("N videos without views data") and excluded from every sum.
export function countWithoutViews(rows: MetricsRowView[]): number {
  return rows.filter((row) => row.views === null).length;
}

//---------------
// shouldUseDonut — a donut only reads as a share view with five or
// fewer groups; past that, bars carry the comparison.
//---------------
export function shouldUseDonut(groupCount: number): boolean {
  return groupCount <= 5;
}

export const TOP_VIDEOS_LIMIT = 10;

//---------------
// topVideosByViews — the most-viewed rows, highest first. Rows with no
// reported views never make the list; ties break on the newest
// collectedAt so the order is deterministic.
//---------------
export function topVideosByViews(
  rows: MetricsRowView[],
  limit: number = TOP_VIDEOS_LIMIT,
): Array<MetricsRowView & { views: number }> {
  return rows
    .filter((row): row is MetricsRowView & { views: number } => row.views !== null)
    .sort((a, b) => b.views - a.views || b.collectedAt.localeCompare(a.collectedAt))
    .slice(0, limit);
}
