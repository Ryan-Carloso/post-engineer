import type { MetricsRowView } from './metrics-query';

export type ChartMetric = 'views' | 'engagement' | 'likes' | 'comments';

export function rowMetricValue(row: MetricsRowView, metric: ChartMetric): number | null {
  if (metric === 'views') return row.views;
  if (metric === 'likes') return row.likes;
  if (metric === 'comments') return row.comments;
  if (row.likes === null && row.comments === null && row.saves === null) return null;
  return (row.likes ?? 0) + (row.comments ?? 0) + (row.saves ?? 0);
}

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
  withoutPublishDate: number;
  withoutMetricValue: number;
}

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

export function breakdownBy(rows: MetricsRowView[], group: BreakdownGroup): BreakdownItem[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.views === null) continue;
    const key = group === 'provider' ? row.provider : (row.personaId ?? 'voiceover');
    totals.set(key, (totals.get(key) ?? 0) + row.views);
  }
  return [...totals.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
}

export function countWithoutViews(rows: MetricsRowView[]): number {
  return rows.filter((row) => row.views === null).length;
}

export function shouldUseDonut(groupCount: number): boolean {
  return groupCount <= 5;
}

export const TOP_VIDEOS_LIMIT = 10;

export function topVideosByViews(
  rows: MetricsRowView[],
  limit: number = TOP_VIDEOS_LIMIT,
): Array<MetricsRowView & { views: number }> {
  return rows
    .filter((row): row is MetricsRowView & { views: number } => row.views !== null)
    .sort((a, b) => b.views - a.views || b.collectedAt.localeCompare(a.collectedAt))
    .slice(0, limit);
}
