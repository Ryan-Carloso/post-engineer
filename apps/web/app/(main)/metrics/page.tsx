'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { usePersonasQuery, useSocialAccountsQuery } from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';
import { AlertIcon, ChartIcon, SpinnerIcon } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MetricsRow } from './metrics-row';
import { MetricsCoverageCard } from './metrics-coverage-card';
import {
  ActiveFilterChips,
  EMPTY_FILTERS,
  MetricsFilterSheet,
  type MetricsFilterPatch,
} from './metrics-filters';
import { PROVIDER_LABELS, accountOption } from '@/lib/account-options';
import { SOCIAL_PROVIDERS } from '@/lib/providers/registry';
import {
  METRICS_NONE,
  METRICS_ROW_LIMIT,
  METRICS_WINDOWS,
  type CoverageItem,
  type MetricsQuery,
  type MetricsRowView,
} from '@/lib/metrics/metrics-query';
import { sortByViews, summarize, useMetricsQuery } from '@/lib/metrics/metrics-dashboard';

//---------------
// MetricsPage — how are my videos doing? Totals over the visible rows
// (no averages, no per-group comparison — that lives on /experiments):
// videos measured, total views, total engagement. One filter bar: the
// window Tabs plus a Filters Sheet with Persona and Network only. The
// list is sorted by views, highest first.
//---------------

const WINDOW_LABEL_KEYS: Record<MetricsQuery['window'], TranslationKey> = {
  '24h': 'metrics.window24h',
  '7d': 'metrics.window7d',
  '28d': 'metrics.window28d',
};

const CARD_CLASS = 'rounded-2xl border border-hairline bg-card shadow-[0_8px_24px_rgba(20,32,51,0.04)]';
const EMPTY_QUERY: MetricsQuery = { window: '24h', personaId: null, accountId: null, provider: null, angle: null };

export default function MetricsPage(): React.ReactElement {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState<MetricsQuery>(EMPTY_QUERY);

  const metricsQuery = useMetricsQuery(query);
  const personasQuery = usePersonasQuery();
  const accountsQuery = useSocialAccountsQuery();

  const personaNames = useMemo(
    () => new Map((personasQuery.data ?? []).map((persona) => [persona.id, persona.name])),
    [personasQuery.data],
  );
  const accounts = useMemo(() => (accountsQuery.data?.accounts ?? []).map(accountOption), [accountsQuery.data]);
  const accountLabels = useMemo(() => new Map(accounts.map((account) => [account.id, account.label])), [accounts]);

  const result = metricsQuery.data;
  const failed = metricsQuery.isError || (result !== undefined && !result.success);
  const rows: MetricsRowView[] = useMemo(
    () => (result !== undefined && result.success ? result.rows : []),
    [result],
  );
  // Coverage (issue #525): the published videos with no snapshot for this
  // window, and the newest collection time. Empty until the first load.
  const coverage: CoverageItem[] = result !== undefined && result.success ? result.coverage : [];
  const coverageTruncated = result !== undefined && result.success ? result.coverageTruncated : false;
  const asOf = result !== undefined && result.success ? result.asOf : null;
  const summary = summarize(rows);
  const sorted = useMemo(() => sortByViews(rows), [rows]);

  const personaLabel = (id: string | null): string =>
    id === null || id === METRICS_NONE ? t('metrics.noPersona') : personaNames.get(id) ?? t('metrics.unknownPersona');
  const personaOptions = useMemo(
    () => [
      ...(personasQuery.data ?? []).map((persona) => ({ value: persona.id, label: persona.name })),
      { value: METRICS_NONE, label: t('metrics.noPersona') },
    ],
    [personasQuery.data, t],
  );
  const providerOptions = useMemo(
    () => SOCIAL_PROVIDERS.map((provider) => ({ value: provider, label: PROVIDER_LABELS[provider] })),
    [],
  );
  const activeFilters = [
    ...(query.personaId === null ? [] : [{ key: 'personaId' as const, label: personaLabel(query.personaId) }]),
    ...(query.provider === null ? [] : [{ key: 'provider' as const, label: PROVIDER_LABELS[query.provider] }]),
  ];

  const update = (patch: Partial<MetricsQuery>): void => setQuery((current) => ({ ...current, ...patch }));
  const applyFilters = (filters: MetricsFilterPatch): void =>
    update({ ...filters, accountId: null, angle: null });
  const filtered = query.personaId !== null || query.provider !== null;
  const formatNumber = (value: number): string => value.toLocaleString(locale === 'pt' ? 'pt-BR' : 'en-US');
  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString(locale === 'pt' ? 'pt-BR' : 'en-US', { dateStyle: 'medium' });
  const formatDateTime = (iso: string): string =>
    new Date(iso).toLocaleString(locale === 'pt' ? 'pt-BR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
  // Tokens granted before yt-analytics.readonly: one prompt for the page,
  // never zeros in the rows.
  const needsReconnect = rows.some((row) => row.analyticsStatus === 'scope_missing');
  const fallbackTitle = (row: MetricsRowView): string =>
    row.scriptAngle ?? `${PROVIDER_LABELS[row.provider]} · ${formatDate(row.collectedAt)}`;

  return (
    <div className="mx-auto flex w-full max-w-375 flex-col gap-5 lg:gap-6">
      <header className="flex items-center gap-4 py-1 lg:py-2">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#17191c] text-white shadow-[0_8px_18px_rgba(16,23,40,0.14)] [&>svg]:size-6">
          <ChartIcon />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.035em] text-ink">{t('metrics.title')}</h1>
          <p className="mt-0.5 text-sm text-muted-text lg:text-base">{t('metrics.subtitle')}</p>
        </div>
      </header>

      <Link href="/experiments" className={cn(CARD_CLASS, 'flex items-center justify-between gap-3 p-4 hover:border-ink/30 lg:p-5')}>
        <span>
          <span className="block text-sm font-semibold text-ink">{t('experiments.entryTitle')}</span>
          <span className="mt-0.5 block text-xs text-muted-text">{t('experiments.entryBody')}</span>
        </span>
        <span className="shrink-0 rounded-xl bg-sunken px-3 py-2 text-sm font-semibold text-ink">{t('experiments.entryAction')}</span>
      </Link>

      <section className={cn(CARD_CLASS, 'flex flex-col gap-4 p-4 lg:p-5')}>
        <div className="flex flex-wrap items-center gap-3">
          <Tabs
            value={query.window}
            onValueChange={(value) => {
              if (value === '24h' || value === '7d' || value === '28d') update({ window: value });
            }}
          >
            <TabsList>
              {METRICS_WINDOWS.map((value) => (
                <TabsTrigger key={value} value={value}>{t(WINDOW_LABEL_KEYS[value])}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <MetricsFilterSheet
            filters={{ personaId: query.personaId, provider: query.provider }}
            onApply={applyFilters}
            personaOptions={personaOptions}
            providerOptions={providerOptions}
          />
        </div>
        <p className="text-xs text-muted-text">{t('metrics.windowCaption')}</p>
        {activeFilters.length > 0 && (
          <ActiveFilterChips
            filters={activeFilters}
            onRemove={(key) => update(key === 'personaId' ? { personaId: null } : { provider: null })}
            onClearAll={() => applyFilters(EMPTY_FILTERS)}
          />
        )}
      </section>

      {needsReconnect && (
        <section role="status" className="flex flex-col gap-3 rounded-2xl border border-warning/30 bg-warning-soft p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-warning">{t('metrics.reconnectTitle')}</p>
            <p className="mt-0.5 text-xs text-warning">{t('metrics.reconnectBody')}</p>
          </div>
          <Link href="/accounts" className="shrink-0 rounded-xl bg-card px-4 py-2 text-center text-sm font-semibold text-warning shadow-sm hover:bg-warning-soft">
            {t('metrics.reconnectAction')}
          </Link>
        </section>
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile label={t('metrics.statVideos')} value={formatNumber(summary.videos)} />
          <StatTile label={t('metrics.statTotalViews')} value={formatNumber(summary.views)} />
          <StatTile
            label={t('metrics.statEngagement')}
            value={formatNumber(summary.engagement)}
            hint={t('metrics.statEngagementHint')}
          />
        </div>
      )}

      <section className={cn(CARD_CLASS, 'p-4 lg:p-6')}>
        <h2 className="mb-2 text-lg font-semibold tracking-[-0.02em] text-ink">{t('metrics.tableTitle')}</h2>
        {asOf !== null && (
          <p className="mb-2 text-xs text-muted-text">{t('metrics.asOf', { date: formatDateTime(asOf) })}</p>
        )}
        {metricsQuery.isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-text"><SpinnerIcon /></div>
        ) : failed ? (
          <StatePanel tone="error" message={t('metrics.loadError')}
            action={<button type="button" onClick={() => void metricsQuery.refetch()} disabled={metricsQuery.isFetching}
              className="rounded-xl border border-line bg-card px-4 py-2 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-50">
              {t('metrics.retry')}
            </button>} />
        ) : rows.length === 0 ? (
          <StatePanel tone="empty" message={t(filtered ? 'metrics.emptyFiltered' : 'metrics.empty')} />
        ) : (
          <ul className="divide-y divide-hairline">
            {sorted.map((row) => (
              <MetricsRow
                key={`${row.postId}:${row.provider}:${row.externalId}`}
                row={row}
                title={fallbackTitle(row)}
                subtitle={`${personaLabel(row.personaId)} · ${accountLabels.get(row.accountId) ?? row.accountId}`}
                formatNumber={formatNumber}
                formatDate={formatDate}
              />
            ))}
          </ul>
        )}
        {result !== undefined && result.success && result.truncated && (
          <p className="mt-3 text-xs text-muted-text">{t('metrics.truncated', { limit: METRICS_ROW_LIMIT })}</p>
        )}
      </section>

      {coverage.length > 0 && (
        <MetricsCoverageCard
          items={coverage}
          truncated={coverageTruncated}
          window={query.window}
          personaLabel={personaLabel}
          accountLabel={(id) => accountLabels.get(id) ?? id}
          formatDateTime={formatDateTime}
        />
      )}
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }): React.ReactElement {
  return (
    <div className={cn(CARD_CLASS, 'p-4')}>
      <p className="text-xs font-semibold text-muted-text">{label}</p>
      <p className="mt-1 truncate text-2xl font-bold tracking-[-0.03em] text-ink">{value}</p>
      {hint !== undefined && <p className="text-xs tabular-nums text-muted-text">{hint}</p>}
    </div>
  );
}

interface StatePanelProps {
  tone: 'error' | 'empty';
  message: string;
  action?: React.ReactNode;
}

function StatePanel({ tone, message, action }: StatePanelProps): React.ReactElement {
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line bg-surface px-6 py-14 text-center"
    >
      <span className={cn(
        'flex size-11 items-center justify-center rounded-full [&>svg]:size-5',
        tone === 'error' ? 'bg-destructive-soft text-destructive' : 'bg-card text-muted-text shadow-sm',
      )}>
        {tone === 'error' ? <AlertIcon /> : <ChartIcon />}
      </span>
      <p className="max-w-md text-sm text-ink-soft">{message}</p>
      {action}
    </div>
  );
}
