'use client';

import { useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useI18n } from '@/lib/i18n/provider';
import { AlertIcon, ChartIcon, SpinnerIcon } from '@/lib/ui';
import { PROVIDER_LABELS } from '@/lib/account-options';
import { METRICS_ROW_LIMIT, type MetricsRowView } from '@/lib/metrics/metrics-query';
import {
  breakdownBy,
  bucketOverTime,
  countWithoutViews,
  dayKeyToDate,
  shouldUseDonut,
  topVideosByViews,
  type BreakdownGroup,
  type ChartMetric,
} from '@/lib/metrics/metrics-chart-data';

//---------------
// MetricsCharts — the three chart cards of the /metrics charts view,
// all computed from the rows already on screen (the charts follow the
// window tabs and the Persona/Network filters because the rows do).
// Nulls are excluded from every sum and stated in a caption. Presentational:
// the page owns the query and passes the rows in.
//---------------

export type MetricsView = 'chart' | 'list';

//---------------
// The Chart/List toggle is remembered per viewer: localStorage may
// throw (private mode, disabled storage), so every read/write is in a
// try/catch and falls back to the list view.
//---------------
export const METRICS_VIEW_STORAGE_KEY = 'metrics-view-mode';

export function readMetricsView(): MetricsView {
  try {
    if (typeof window === 'undefined') return 'list';
    return window.localStorage.getItem(METRICS_VIEW_STORAGE_KEY) === 'chart' ? 'chart' : 'list';
  } catch {
    return 'list';
  }
}

export function writeMetricsView(view: MetricsView): void {
  try {
    window.localStorage.setItem(METRICS_VIEW_STORAGE_KEY, view);
  } catch {
    // Storage unavailable: the page still holds the choice in state.
  }
}

export function rowElementId(row: MetricsRowView): string {
  return `metric-row-${row.postId}-${row.provider}-${row.externalId}`;
}

//---------------
// withoutViewsKey / withoutPublishDateKey / withoutMetricKey
// map the excluded-row captions to their singular (count === 1) or
// plural copy. The i18n keys exist in PT and EN so the sentence reads
// "1 vídeo/video" for one and "N vídeos/videos" otherwise.

export function withoutViewsKey(count: number): 'metrics.chartsWithoutView' | 'metrics.chartsWithoutViews' {
  return count === 1 ? 'metrics.chartsWithoutView' : 'metrics.chartsWithoutViews';
}

export function withoutPublishDateKey(count: number): 'metrics.chartsWithoutPublishDateOne' | 'metrics.chartsWithoutPublishDate' {
  return count === 1 ? 'metrics.chartsWithoutPublishDateOne' : 'metrics.chartsWithoutPublishDate';
}

export function withoutMetricKey(count: number): 'metrics.chartsWithoutMetricOne' | 'metrics.chartsWithoutMetric' {
  return count === 1 ? 'metrics.chartsWithoutMetricOne' : 'metrics.chartsWithoutMetric';
}

export function MetricsViewToggle({ value, onChange }: { value: MetricsView; onChange: (view: MetricsView) => void }): React.ReactElement {
  const { t } = useI18n();
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        if (next === 'chart' || next === 'list') onChange(next);
      }}
    >
      <TabsList>
        <TabsTrigger value="chart">{t('metrics.viewChart')}</TabsTrigger>
        <TabsTrigger value="list">{t('metrics.viewList')}</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

const CARD_CLASS = 'rounded-2xl border border-hairline bg-card p-4 shadow-[0_8px_24px_rgba(20,32,51,0.04)] lg:p-5';
const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

interface MetricsChartsProps {
  rows: MetricsRowView[];
  isLoading: boolean;
  isError: boolean;
  truncated: boolean;
  personaLabel: (id: string | null) => string;
  rowTitle: (row: MetricsRowView) => string;
  onSelectRow: (row: MetricsRowView) => void;
}

export function MetricsCharts({ rows, isLoading, isError, truncated, personaLabel, rowTitle, onSelectRow }: MetricsChartsProps): React.ReactElement {
  const { t, locale } = useI18n();
  const [metric, setMetric] = useState<ChartMetric>('views');
  const [breakdownGroup, setBreakdownGroup] = useState<BreakdownGroup>('provider');

  const formatNumber = (value: number): string => value.toLocaleString(locale === 'pt' ? 'pt-BR' : 'en-US');
  const formatCompact = (value: number): string =>
    new Intl.NumberFormat(locale === 'pt' ? 'pt-BR' : 'en-US', { notation: 'compact' }).format(value);
  const formatDay = (day: string): string =>
    dayKeyToDate(day).toLocaleDateString(locale === 'pt' ? 'pt-BR' : 'en-US', { dateStyle: 'medium' });

  const overTime = useMemo(() => bucketOverTime(rows, metric), [rows, metric]);
  const metricLabelKey: Record<ChartMetric, 'metrics.chartsMetricViews' | 'metrics.chartsMetricEngagement' | 'metrics.chartsMetricLikes' | 'metrics.chartsMetricComments'> = {
    views: 'metrics.chartsMetricViews',
    engagement: 'metrics.chartsMetricEngagement',
    likes: 'metrics.chartsMetricLikes',
    comments: 'metrics.chartsMetricComments',
  };

  const breakdown = useMemo(() => breakdownBy(rows, breakdownGroup), [rows, breakdownGroup]);
  const breakdownLabel = (key: string): string =>
    breakdownGroup === 'provider' ? (PROVIDER_LABELS[key as keyof typeof PROVIDER_LABELS] ?? key) : key === 'faceless' ? t('metrics.noPersona') : personaLabel(key);
  const withoutViews = countWithoutViews(rows);

  const top = useMemo(() => topVideosByViews(rows), [rows]);
  const topData = useMemo(
    () => top.map((row) => ({ label: rowTitle(row), value: row.views as number, row })),
    [top, rowTitle],
  );

  const overTimeConfig: ChartConfig = { value: { label: t(metricLabelKey[metric]), color: 'var(--chart-1)' } };
  const breakdownConfig: ChartConfig = { value: { label: t('metrics.chartsMetricViews'), color: 'var(--chart-1)' } };
  const topConfig: ChartConfig = { value: { label: t('metrics.chartsMetricViews'), color: 'var(--chart-1)' } };

  const footnotes = (extra: string[]): React.ReactNode => (
    <>
      {extra.map((caption) => (
        <p key={caption} className="mt-1 text-xs text-muted-text">{caption}</p>
      ))}
      {truncated && <p className="mt-1 text-xs text-muted-text">{t('metrics.chartsTruncated', { limit: METRICS_ROW_LIMIT })}</p>}
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <section className={CARD_CLASS} aria-label={t('metrics.chartsOverTimeTitle')}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">{t('metrics.chartsOverTimeTitle')}</h2>
          <Tabs
            value={metric}
            onValueChange={(next) => {
              if (next === 'views' || next === 'engagement' || next === 'likes' || next === 'comments') setMetric(next);
            }}
          >
            <TabsList className="h-auto flex-wrap">
              <TabsTrigger value="views">{t('metrics.chartsMetricViews')}</TabsTrigger>
              <TabsTrigger value="engagement">{t('metrics.chartsMetricEngagement')}</TabsTrigger>
              <TabsTrigger value="likes">{t('metrics.chartsMetricLikes')}</TabsTrigger>
              <TabsTrigger value="comments">{t('metrics.chartsMetricComments')}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <ChartState isLoading={isLoading} isError={isError} isEmpty={overTime.points.length === 0}>
          <ChartContainer config={overTimeConfig} className="aspect-auto h-52 w-full">
            <AreaChart data={overTime.points} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis type="category" dataKey="day" tickLine={false} axisLine={false} minTickGap={24} tickFormatter={(day: string) => formatDay(day)} />
              <YAxis width={52} tickLine={false} axisLine={false} tickFormatter={(value: number) => formatCompact(value)} />
              <ChartTooltip content={<ChartTooltipContent
                formatter={(value, name) => `${String(overTimeConfig[String(name)]?.label ?? name)}: ${formatNumber(Number(value))}`}
              />} />
              <Area dataKey="value" type="monotone" stroke="var(--color-value)" fill="var(--color-value)" fillOpacity={0.18} strokeWidth={2} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ChartContainer>
        </ChartState>
        {footnotes([
          ...(overTime.withoutPublishDate > 0 ? [t(withoutPublishDateKey(overTime.withoutPublishDate), { count: overTime.withoutPublishDate })] : []),
          ...(overTime.withoutMetricValue > 0 ? [t(withoutMetricKey(overTime.withoutMetricValue), { count: overTime.withoutMetricValue, metric: t(metricLabelKey[metric]).toLowerCase() })] : []),
        ])}
      </section>

      <section className={CARD_CLASS} aria-label={t('metrics.chartsBreakdownTitle')}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">{t('metrics.chartsBreakdownTitle')}</h2>
          <Tabs
            value={breakdownGroup}
            onValueChange={(next) => {
              if (next === 'provider' || next === 'persona') setBreakdownGroup(next);
            }}
          >
            <TabsList>
              <TabsTrigger value="provider">{t('metrics.chartsByNetwork')}</TabsTrigger>
              <TabsTrigger value="persona">{t('metrics.chartsByPersona')}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <ChartState isLoading={isLoading} isError={isError} isEmpty={breakdown.length === 0}>
          {shouldUseDonut(breakdown.length) ? (
            <>
              <ChartContainer config={breakdownConfig} className="aspect-auto h-56 w-full">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent
                    formatter={(value, name) => `${String(breakdownConfig[String(name)]?.label ?? name)}: ${formatNumber(Number(value))}`}
                  />} />
                  <Pie
                    data={breakdown.map((item) => ({ label: breakdownLabel(item.key), value: item.value }))}
                    dataKey="value"
                    nameKey="label"
                    innerRadius={56}
                    outerRadius={88}
                    paddingAngle={2}
                    isAnimationActive={false}
                  >
                    {breakdown.map((item, index) => (
                      <Cell key={item.key} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {breakdown.map((item, index) => (
                  <li key={item.key} className="flex items-center gap-1.5 text-xs text-ink-soft tabular-nums">
                    <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
                    {breakdownLabel(item.key)} · {formatNumber(item.value)}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <ChartContainer config={breakdownConfig} className="aspect-auto h-64 w-full">
              <BarChart data={breakdown.map((item) => ({ label: breakdownLabel(item.key), value: item.value }))} layout="vertical" margin={{ left: 0, right: 12, top: 4, bottom: 0 }}>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(value: number) => formatCompact(value)} />
                <YAxis type="category" dataKey="label" width={112} tickLine={false} axisLine={false} />
                <ChartTooltip cursor={{ fill: 'var(--color-value)', fillOpacity: 0.12 }} content={<ChartTooltipContent
                  formatter={(value, name) => `${String(breakdownConfig[String(name)]?.label ?? name)}: ${formatNumber(Number(value))}`}
                />} />
                <Bar dataKey="value" fill="var(--color-value)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
              </BarChart>
            </ChartContainer>
          )}
        </ChartState>
        {footnotes(withoutViews > 0 ? [t(withoutViewsKey(withoutViews), { count: withoutViews })] : [])}
      </section>

      <section className={CARD_CLASS} aria-label={t('metrics.chartsTopTitle')}>
        <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">{t('metrics.chartsTopTitle')}</h2>
        <ChartState isLoading={isLoading} isError={isError} isEmpty={topData.length === 0}>
          <ChartContainer config={topConfig} className="aspect-auto h-72 w-full">
            <BarChart
              data={topData}
              layout="vertical"
              margin={{ left: 0, right: 12, top: 4, bottom: 0 }}
              onClick={(_data: unknown, index: number) => {
                const selected = topData[index];
                if (selected !== undefined) onSelectRow(selected.row);
              }}
            >
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(value: number) => formatCompact(value)} />
              <YAxis
                type="category"
                dataKey="label"
                width={128}
                tickLine={false}
                axisLine={false}
                tickFormatter={(label: string) => (label.length > 20 ? `${label.slice(0, 19)}…` : label)}
              />
              <ChartTooltip cursor={{ fill: 'var(--color-value)', fillOpacity: 0.12 }} content={<ChartTooltipContent
                formatter={(value, name) => `${String(topConfig[String(name)]?.label ?? name)}: ${formatNumber(Number(value))}`}
              />} />
              <Bar dataKey="value" fill="var(--color-value)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
            </BarChart>
          </ChartContainer>
        </ChartState>
        {footnotes(withoutViews > 0 ? [t(withoutViewsKey(withoutViews), { count: withoutViews })] : [])}
      </section>
    </div>
  );
}

function ChartState({ isLoading, isError, isEmpty, children }: { isLoading: boolean; isError: boolean; isEmpty: boolean; children: React.ReactNode }): React.ReactElement {
  const { t } = useI18n();
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-text" role="status" aria-label={t('metrics.chartsLoading')}>
        <SpinnerIcon />
        <span className="text-sm">{t('metrics.chartsLoading')}</span>
      </div>
    );
  }
  if (isError) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line bg-surface px-6 py-12 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-destructive-soft text-destructive [&>svg]:size-5"><AlertIcon /></span>
        <p className="max-w-md text-sm text-ink-soft">{t('metrics.loadError')}</p>
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-surface px-6 py-12 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-card text-muted-text shadow-sm [&>svg]:size-5"><ChartIcon /></span>
        <p className="max-w-md text-sm text-ink-soft">{t('metrics.chartsEmpty')}</p>
      </div>
    );
  }
  return <>{children}</>;
}
