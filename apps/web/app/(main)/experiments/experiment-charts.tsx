'use client';

import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts';
import { useI18n } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import { PROVIDER_LABELS } from '@/lib/account-options';
import { isSocialProvider } from '@/lib/providers/registry';
import {
  EXPERIMENT_CHART_METRICS,
  pairChartRows,
  variantMetricTotals,
  winSplit,
  type ExperimentChartMetric,
} from '@/lib/experiments/experiment-chart-data';
import type {
  ExperimentPairComparison,
  ExperimentProviderResult,
} from '@/lib/experiments/experiments-dashboard';
import type { ExperimentResultLabel } from '@/lib/experiments/results';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

//---------------
// experiment-charts — per-provider A/B charts (issue #647): variant
// comparison, per-pair rows and win split, all from the comparisons the
// API already returns. The per-pair table stays behind "Show table" as
// the accessible fallback; every chart also states its totals as text.
// Theme tokens only (var(--info) / var(--warning) / var(--faint));
// A/B are labelled by name, so they are distinguishable without colour.
//---------------

const LABEL_BADGE_CLASS: Record<ExperimentResultLabel, string> = {
  pending: 'bg-surface text-muted-text',
  indicative: 'bg-warning-soft text-warning',
  clear: 'bg-success-soft text-success',
};

const METRIC_LABEL_KEY = {
  views: 'experiments.metricViews',
  likes: 'experiments.metricLikes',
  comments: 'experiments.metricComments',
  averageViewDurationSeconds: 'experiments.metricAvgDuration',
} as const satisfies Record<ExperimentChartMetric, string>;

function isChartMetric(value: string): value is ExperimentChartMetric {
  return EXPERIMENT_CHART_METRICS.some((option) => option === value);
}

export function ProviderCard({ provider, firstName, secondName, firstId, secondId, variantName, pairsCreated, formatNumber }: {
  provider: ExperimentProviderResult;
  firstName: string;
  secondName: string;
  firstId: string;
  secondId: string;
  variantName: (variantId: string) => string;
  pairsCreated: number;
  formatNumber: (value: number) => string;
}): React.ReactElement {
  const { t } = useI18n();
  const [metric, setMetric] = useState<ExperimentChartMetric>('views');
  const [showTable, setShowTable] = useState(false);
  const labelKey = provider.label === 'clear'
    ? 'experiments.labelClear'
    : provider.label === 'indicative'
      ? 'experiments.labelIndicative'
      : 'experiments.labelPending';
  const winsFirst = provider.wins[firstId] ?? 0;
  const winsSecond = provider.wins[secondId] ?? 0;
  return (
    <section className={cn('rounded-2xl border border-hairline bg-card shadow-[0_8px_24px_rgba(20,32,51,0.04)]', 'p-4 lg:p-6')}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">
          {isSocialProvider(provider.provider) ? PROVIDER_LABELS[provider.provider] : provider.provider}
        </h2>
        <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', LABEL_BADGE_CLASS[provider.label])}>
          {t(labelKey)}
        </span>
      </div>
      <p className="text-sm text-ink">
        {t('experiments.wins')}: {firstName} {formatNumber(winsFirst)} — {formatNumber(winsSecond)} {secondName}
      </p>
      <p className="mt-1 text-sm text-muted-text">
        {t('experiments.pValue', { value: provider.pValue === null ? '—' : provider.pValue.toFixed(3) })}
      </p>
      <p className="mt-1 text-sm font-semibold text-ink">
        {provider.label === 'clear' && provider.leader !== null
          ? t('experiments.winner', { name: variantName(provider.leader) })
          : t('experiments.noWinner')}
      </p>
      <WinSplitChart provider={provider} firstName={firstName} secondName={secondName} firstId={firstId} secondId={secondId} formatNumber={formatNumber} />
      <MetricToggle metric={metric} onChange={setMetric} />
      <VariantComparisonChart
        comparisons={provider.comparisons}
        firstId={firstId}
        secondId={secondId}
        firstName={firstName}
        secondName={secondName}
        metric={metric}
        formatNumber={formatNumber}
      />
      <PerPairChart
        comparisons={provider.comparisons}
        firstId={firstId}
        secondId={secondId}
        firstName={firstName}
        secondName={secondName}
        metric={metric}
        formatNumber={formatNumber}
      />
      <div className="mt-4">
        <button
          type="button"
          aria-expanded={showTable}
          onClick={() => setShowTable((value) => !value)}
          className="rounded-xl border border-line bg-card px-4 py-2 text-sm font-semibold text-ink hover:bg-surface"
        >
          {t(showTable ? 'experiments.hideTable' : 'experiments.showTable')}
        </button>
        {showTable && (
          <PairTable
            pairsCreated={pairsCreated}
            comparisons={provider.comparisons}
            firstName={firstName}
            secondName={secondName}
            firstId={firstId}
            secondId={secondId}
            variantName={variantName}
            formatNumber={formatNumber}
          />
        )}
      </div>
    </section>
  );
}

function MetricToggle({ metric, onChange }: {
  metric: ExperimentChartMetric;
  onChange: (metric: ExperimentChartMetric) => void;
}): React.ReactElement {
  const { t } = useI18n();
  return (
    <Tabs value={metric} onValueChange={(value) => { if (isChartMetric(value)) onChange(value); }} aria-label={t('experiments.metricToggleLabel')} className="mt-6">
      <TabsList className="h-auto max-w-full flex-wrap justify-start gap-1 p-1">
        {EXPERIMENT_CHART_METRICS.map((option) => (
          <TabsTrigger key={option} value={option} className="px-2 py-1 text-xs sm:px-3 sm:text-sm">
            {t(METRIC_LABEL_KEY[option])}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

export function VariantComparisonChart({ comparisons, firstId, secondId, firstName, secondName, metric, formatNumber }: {
  comparisons: ExperimentPairComparison[];
  firstId: string;
  secondId: string;
  firstName: string;
  secondName: string;
  metric: ExperimentChartMetric;
  formatNumber: (value: number) => string;
}): React.ReactElement {
  const { t } = useI18n();
  const totalsA = variantMetricTotals(comparisons, firstId, metric);
  const totalsB = variantMetricTotals(comparisons, secondId, metric);
  const excluded = totalsA.excludedNulls + totalsB.excludedNulls;
  const hasA = totalsA.includedPairs > 0;
  const hasB = totalsB.includedPairs > 0;
  const hasData = hasA || hasB;
  // One group, two series (grouped bars). A variant with no non-null
  // value has no series at all, so its bar is never drawn, not drawn as 0.
  const rows = [{ name: t(METRIC_LABEL_KEY[metric]), a: hasA ? totalsA.total : 0, b: hasB ? totalsB.total : 0 }];
  const config: ChartConfig = {
    a: { label: firstName, color: 'var(--info)' },
    b: { label: secondName, color: 'var(--warning)' },
  };
  const totalsText = `${firstName}: ${hasA ? formatNumber(totalsA.total) : '—'} · ${secondName}: ${hasB ? formatNumber(totalsB.total) : '—'}`;
  return (
    <figure className="mt-4">
      <figcaption className="mb-2 text-sm font-semibold text-ink">{t('experiments.variantComparison')}</figcaption>
      <p className="mb-2 text-sm text-muted-text">{totalsText}</p>
      {excluded === 1 && <p className="mb-2 text-xs text-muted-text">{t('experiments.excludedNullOne')}</p>}
      {excluded > 1 && <p className="mb-2 text-xs text-muted-text">{t('experiments.excludedNullOther', { count: excluded })}</p>}
      {comparisons.length === 0 ? (
        <ChartEmpty message={t('experiments.noPairData')} />
      ) : !hasData ? (
        <ChartEmpty message={t('experiments.noMetricData')} />
      ) : (
        <ChartContainer config={config} className="aspect-auto h-56 w-full">
          <BarChart data={rows} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="name" hide />
            <YAxis width={48} tickFormatter={(value: number) => formatNumber(value)} tickLine={false} axisLine={false} />
            <ChartTooltip
              content={<ChartTooltipContent formatter={(value, name) => `${name === 'a' ? firstName : secondName}: ${formatNumber(Number(value))}`} />}
            />
            <ChartLegend content={<ChartLegendContent />} verticalAlign="top" />
            {hasA && <Bar dataKey="a" isAnimationActive={false} radius={[6, 6, 0, 0]} fill="var(--color-a)" />}
            {hasB && <Bar dataKey="b" isAnimationActive={false} radius={[6, 6, 0, 0]} fill="var(--color-b)" />}
          </BarChart>
        </ChartContainer>
      )}
    </figure>
  );
}

export function PerPairChart({ comparisons, firstId, secondId, firstName, secondName, metric, formatNumber }: {
  comparisons: ExperimentPairComparison[];
  firstId: string;
  secondId: string;
  firstName: string;
  secondName: string;
  metric: ExperimentChartMetric;
  formatNumber: (value: number) => string;
}): React.ReactElement {
  const { t } = useI18n();
  const rows = pairChartRows(comparisons, firstId, secondId, metric);
  const hasData = rows.some((row) => row.a !== null || row.b !== null);
  const config: ChartConfig = {
    a: { label: firstName, color: 'var(--info)' },
    b: { label: secondName, color: 'var(--warning)' },
  };
  return (
    <figure className="mt-6">
      <figcaption className="mb-2 text-sm font-semibold text-ink">{t('experiments.perPair')}</figcaption>
      {comparisons.length === 0 ? (
        <ChartEmpty message={t('experiments.noPairData')} />
      ) : !hasData ? (
        <ChartEmpty message={t('experiments.noMetricData')} />
      ) : (
        <ChartContainer config={config} className="aspect-auto h-56 w-full">
          <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
            <CartesianGrid horizontal={false} />
            <XAxis type="number" tickFormatter={(value: number) => formatNumber(value)} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="pair" width={36} tickLine={false} axisLine={false} />
            <ChartTooltip
              content={<ChartTooltipContent formatter={(value, name) => `${name === 'a' ? firstName : secondName}: ${formatNumber(Number(value))}`} />}
            />
            <ChartLegend content={<ChartLegendContent />} verticalAlign="top" />
            <Bar dataKey="a" isAnimationActive={false} radius={[0, 6, 6, 0]} fill="var(--color-a)">
              {rows.map((row) => (
                <Cell key={`a-${row.pair}`} fill={cellFill(row.winner, row.a, firstId, 'a')} />
              ))}
            </Bar>
            <Bar dataKey="b" isAnimationActive={false} radius={[0, 6, 6, 0]} fill="var(--color-b)">
              {rows.map((row) => (
                <Cell key={`b-${row.pair}`} fill={cellFill(row.winner, row.b, secondId, 'b')} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      )}
    </figure>
  );
}

export function WinSplitChart({ provider, firstName, secondName, firstId, secondId, formatNumber }: {
  provider: ExperimentProviderResult;
  firstName: string;
  secondName: string;
  firstId: string;
  secondId: string;
  formatNumber: (value: number) => string;
}): React.ReactElement {
  const { t } = useI18n();
  const split = winSplit(provider, firstId, secondId);
  const total = split.winsA + split.ties + split.winsB;
  const rows = [{ name: 'wins', a: split.winsA, ties: split.ties, b: split.winsB }];
  const config: ChartConfig = {
    a: { label: firstName, color: 'var(--info)' },
    ties: { label: t('experiments.tie'), color: 'var(--faint)' },
    b: { label: secondName, color: 'var(--warning)' },
  };
  const splitText = `${firstName}: ${formatNumber(split.winsA)} · ${t('experiments.tie')}: ${formatNumber(split.ties)} · ${secondName}: ${formatNumber(split.winsB)}`;
  return (
    <figure className="mt-4">
      <figcaption className="mb-2 text-sm font-semibold text-ink">{t('experiments.winSplit')}</figcaption>
      <p className="mb-2 text-sm text-muted-text">{splitText}</p>
      {total === 0 ? (
        <ChartEmpty message={t('experiments.noPairData')} />
      ) : (
        <ChartContainer config={config} className="aspect-auto h-28 w-full">
          <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
            <CartesianGrid horizontal={false} />
            <XAxis type="number" allowDecimals={false} tickFormatter={(value: number) => formatNumber(value)} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" width={1} tickLine={false} axisLine={false} tick={false} />
            <ChartTooltip
              content={<ChartTooltipContent formatter={(value, name) => `${name === 'a' ? firstName : name === 'b' ? secondName : t('experiments.tie')}: ${formatNumber(Number(value))}`} />}
            />
            <ChartLegend content={<ChartLegendContent />} verticalAlign="top" />
            <Bar dataKey="a" isAnimationActive={false} stackId="wins" fill="var(--color-a)" />
            <Bar dataKey="ties" isAnimationActive={false} stackId="wins" fill="var(--color-ties)" />
            <Bar dataKey="b" isAnimationActive={false} stackId="wins" fill="var(--color-b)" />
          </BarChart>
        </ChartContainer>
      )}
    </figure>
  );
}

function cellFill(winner: string | null, value: number | null, variantId: string, fallback: 'a' | 'b'): string {
  if (value === null) return 'transparent';
  if (winner === null) return 'var(--faint)';
  if (winner === variantId) return `var(--color-${fallback})`;
  return 'var(--faint)';
}

function ChartEmpty({ message }: { message: string }): React.ReactElement {
  return (
    <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-line bg-surface px-6 text-center text-sm text-muted-text">
      <p>{message}</p>
    </div>
  );
}

function PairTable({ pairsCreated, comparisons, firstName, secondName, firstId, secondId, variantName, formatNumber }: {
  pairsCreated: number;
  comparisons: ExperimentPairComparison[];
  firstName: string;
  secondName: string;
  firstId: string;
  secondId: string;
  variantName: (variantId: string) => string;
  formatNumber: (value: number) => string;
}): React.ReactElement {
  const { t } = useI18n();
  return (
    <div className="overflow-x-auto">
      <table className="mt-4 w-full min-w-80 text-sm">
        <thead>
          <tr className="border-b border-hairline text-left text-xs font-semibold text-muted-text">
            <th scope="col" className="py-2 pr-2">{t('experiments.pairHeader')}</th>
            <th scope="col" className="py-2 pr-2 text-right">{firstName}</th>
            <th scope="col" className="py-2 pr-2 text-right">{secondName}</th>
            <th scope="col" className="py-2 text-right">{t('experiments.winnerHeader')}</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: pairsCreated }, (_, index) => index + 1).map((pair) => {
            const comparison = comparisons.find((entry) => entry.pair === pair);
            const viewsFirst = comparison?.values[firstId]?.views ?? null;
            const viewsSecond = comparison?.values[secondId]?.views ?? null;
            const winner = comparison?.winner ?? null;
            return (
              <tr key={pair} className="border-b border-hairline last:border-b-0">
                <td className="py-2 pr-2 text-muted-text tabular-nums">{pair}</td>
                <td className="py-2 pr-2 text-right text-ink tabular-nums">{viewsFirst === null ? '—' : formatNumber(viewsFirst)}</td>
                <td className="py-2 pr-2 text-right text-ink tabular-nums">{viewsSecond === null ? '—' : formatNumber(viewsSecond)}</td>
                <td className="py-2 text-right font-medium text-ink">
                  {winner === null ? (comparison === undefined ? t('experiments.noData') : t('experiments.tie')) : variantName(winner)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
