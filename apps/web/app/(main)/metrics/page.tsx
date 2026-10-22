'use client';

import { useMemo, useState } from 'react';
import { usePersonasQuery, useSocialAccountsQuery } from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';
import { AlertIcon, ChartIcon, SpinnerIcon } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { ProviderIcon } from '@/components/provider-icon';
import { MetricsBarChart } from '@/components/ui/metrics-bar-chart';
import { PROVIDER_LABELS, accountOption } from '@/lib/account-options';
import { SOCIAL_PROVIDERS, isSocialProvider } from '@/lib/providers/registry';
import { METRICS_NONE, METRICS_ROW_LIMIT, type MetricsQuery, type MetricsRowView } from '@/lib/metrics/metrics-query';
import {
  GROUP_KEYS,
  METRIC_KEYS,
  distinctAngles,
  groupMetrics,
  isGroupKey,
  useMetricsQuery,
  type GroupKey,
  type MetricKey,
} from '@/lib/metrics/metrics-dashboard';

//---------------
// MetricsPage — per-video performance at the same age (24h or 7d after
// publishing), filtered by persona, account, network and script angle and
// compared as averages per group.
//---------------

const METRIC_LABEL_KEYS: Record<MetricKey, TranslationKey> = {
  views: 'metrics.metricViews',
  likes: 'metrics.metricLikes',
  comments: 'metrics.metricComments',
  saves: 'metrics.metricSaves',
};

const GROUP_LABEL_KEYS: Record<GroupKey, TranslationKey> = {
  persona: 'metrics.groupPersona',
  account: 'metrics.groupAccount',
  provider: 'metrics.groupProvider',
  angle: 'metrics.groupAngle',
};

const CARD_CLASS = 'rounded-2xl border border-[#edf0f4] bg-white shadow-[0_8px_24px_rgba(20,32,51,0.04)]';
// appearance-none + inline chevron: the native arrow renders differently on
// every browser and squeezes the label.
const SELECT_CLASS =
  "w-full appearance-none rounded-xl border border-[#e3e8ee] bg-white bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23718096'%3E%3Cpath d='M5.5 7.5 10 12l4.5-4.5'/%3E%3C/svg%3E\")] bg-[length:16px] bg-[right_10px_center] bg-no-repeat py-2.5 pr-9 pl-3 text-sm font-medium text-[#101728] transition-colors hover:border-[#c9d2dc] focus:border-[#101728] focus:ring-2 focus:ring-[#101728]/10 focus:outline-none";
const ALL = 'all';
const EMPTY_QUERY: Omit<MetricsQuery, 'window'> = { personaId: null, accountId: null, provider: null, angle: null };

export default function MetricsPage(): React.ReactElement {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState<MetricsQuery>({ window: '24h', ...EMPTY_QUERY });
  const [metric, setMetric] = useState<MetricKey>('views');
  const [group, setGroup] = useState<GroupKey>('angle');

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
  const rows: MetricsRowView[] = result !== undefined && result.success ? result.rows : [];
  const angles = useMemo(() => {
    const loaded = distinctAngles(rows);
    // Keep the selected angle listed even when the filtered rows hide others.
    return query.angle !== null && query.angle !== METRICS_NONE && !loaded.includes(query.angle)
      ? [query.angle, ...loaded]
      : loaded;
  }, [rows, query.angle]);

  const personaLabel = (id: string | null): string =>
    id === null || id === METRICS_NONE ? t('metrics.noPersona') : personaNames.get(id) ?? t('metrics.unknownPersona');
  const labelFor = (key: string): string => {
    if (group === 'provider') return isSocialProvider(key) ? PROVIDER_LABELS[key] : key;
    if (group === 'account') return accountLabels.get(key) ?? key;
    if (group === 'persona') return personaLabel(key);
    return key === METRICS_NONE ? t('metrics.noAngle') : key;
  };
  const groups = groupMetrics(rows, group, metric);
  const chartData = groups.map((entry) => ({
    label: labelFor(entry.key),
    average: entry.average,
    countLabel: t('metrics.videosCount', { count: entry.count }),
  }));

  const update = (patch: Partial<MetricsQuery>): void => setQuery((current) => ({ ...current, ...patch }));
  const filtered = query.personaId !== null || query.accountId !== null || query.provider !== null || query.angle !== null;
  const metricLabel = t(METRIC_LABEL_KEYS[metric]);
  const groupLabel = t(GROUP_LABEL_KEYS[group]);
  const formatNumber = (value: number): string => value.toLocaleString(locale === 'pt' ? 'pt-BR' : 'en-US');
  const reported = rows.flatMap((row) => (row[metric] === null ? [] : [row[metric]]));
  const overallAverage = reported.length === 0 ? null : Math.round(reported.reduce((sum, value) => sum + value, 0) / reported.length);

  return (
    <div className="mx-auto flex w-full max-w-375 flex-col gap-5 lg:gap-6">
      <header className="flex items-center gap-4 py-1 lg:py-2">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#17191c] text-white shadow-[0_8px_18px_rgba(16,23,40,0.14)] [&>svg]:size-6">
          <ChartIcon />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.035em] text-[#101728]">{t('metrics.title')}</h1>
          <p className="mt-0.5 text-sm text-[#718096] lg:text-base">{t('metrics.subtitle')}</p>
        </div>
      </header>

      <section className={cn(CARD_CLASS, 'flex flex-col gap-4 p-4 lg:p-5')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            options={(['24h', '7d'] as const).map((value) => ({
              value,
              label: t(value === '24h' ? 'metrics.window24h' : 'metrics.window7d'),
            }))}
            value={query.window}
            onChange={(value) => update({ window: value })}
          />
          {filtered && (
            <button
              type="button"
              onClick={() => update(EMPTY_QUERY)}
              className="text-sm font-semibold text-[#718096] underline-offset-4 hover:text-[#101728] hover:underline"
            >
              {t('metrics.clearFilters')}
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect label={t('metrics.filterPersona')} value={query.personaId ?? ALL}
            onChange={(value) => update({ personaId: value === ALL ? null : value })}>
            <option value={ALL}>{t('metrics.filterAll')}</option>
            {(personasQuery.data ?? []).map((persona) => <option key={persona.id} value={persona.id}>{persona.name}</option>)}
            <option value={METRICS_NONE}>{t('metrics.noPersona')}</option>
          </FilterSelect>
          <FilterSelect label={t('metrics.filterProvider')} value={query.provider ?? ALL}
            onChange={(value) => update({ provider: isSocialProvider(value) ? value : null, accountId: null })}>
            <option value={ALL}>{t('metrics.filterAll')}</option>
            {SOCIAL_PROVIDERS.map((provider) => <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>)}
          </FilterSelect>
          <FilterSelect label={t('metrics.filterAccount')} value={query.accountId ?? ALL}
            onChange={(value) => update({ accountId: value === ALL ? null : value })}>
            <option value={ALL}>{t('metrics.filterAll')}</option>
            {accounts.filter((account) => query.provider === null || account.provider === query.provider).map((account) => (
              <option key={`${account.provider}:${account.id}`} value={account.id}>{account.label}</option>
            ))}
          </FilterSelect>
          <FilterSelect label={t('metrics.filterAngle')} value={query.angle ?? ALL}
            onChange={(value) => update({ angle: value === ALL ? null : value })}>
            <option value={ALL}>{t('metrics.filterAll')}</option>
            {angles.map((angle) => <option key={angle} value={angle}>{angle}</option>)}
            <option value={METRICS_NONE}>{t('metrics.noAngle')}</option>
          </FilterSelect>
        </div>
      </section>

      {rows.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile label={t('metrics.statVideos')} value={formatNumber(rows.length)} />
          <StatTile
            label={t('metrics.statAverage', { metric: metricLabel.toLowerCase() })}
            value={overallAverage === null ? t('metrics.notReported') : formatNumber(overallAverage)}
          />
          <StatTile
            label={t('metrics.statBest', { group: groupLabel.toLowerCase() })}
            value={groups.length === 0 ? t('metrics.notReported') : labelFor(groups[0].key)}
            hint={groups.length === 0 ? undefined : formatNumber(groups[0].average)}
          />
        </div>
      )}

      <section className={cn(CARD_CLASS, 'p-4 lg:p-6')}>
        <div className="mb-5 flex flex-col gap-4">
          <h2 className="text-lg font-semibold tracking-[-0.02em] text-[#101728]">
            {t('metrics.chartTitle', { metric: metricLabel.toLowerCase(), group: groupLabel.toLowerCase() })}
          </h2>
          <div className="flex min-w-0 flex-wrap items-end gap-3">
            <Segmented
              options={METRIC_KEYS.map((key) => ({ value: key, label: t(METRIC_LABEL_KEYS[key]) }))}
              value={metric}
              onChange={setMetric}
            />
            <div className="w-full sm:w-52">
              <FilterSelect label={t('metrics.groupLabel')} value={group}
                onChange={(value) => { if (isGroupKey(value)) setGroup(value); }}>
                {GROUP_KEYS.map((key) => <option key={key} value={key}>{t(GROUP_LABEL_KEYS[key])}</option>)}
              </FilterSelect>
            </div>
          </div>
        </div>
        {metricsQuery.isLoading ? (
          <div className="flex items-center justify-center py-20 text-[#718096]"><SpinnerIcon /></div>
        ) : failed ? (
          <StatePanel tone="error" message={t('metrics.loadError')}
            action={<button type="button" onClick={() => void metricsQuery.refetch()} disabled={metricsQuery.isFetching}
              className="rounded-xl border border-[#e3e8ee] bg-white px-4 py-2 text-sm font-semibold text-[#101728] hover:bg-[#f7f8fa] disabled:opacity-50">
              {t('metrics.retry')}
            </button>} />
        ) : rows.length === 0 ? (
          <StatePanel tone="empty" message={t(filtered ? 'metrics.emptyFiltered' : 'metrics.empty')} />
        ) : (
          <MetricsBarChart data={chartData} metricLabel={metricLabel} formatValue={formatNumber} />
        )}
        {result !== undefined && result.success && result.truncated && (
          <p className="mt-3 text-xs text-[#718096]">{t('metrics.truncated', { limit: METRICS_ROW_LIMIT })}</p>
        )}
      </section>

      {rows.length > 0 && (
        <section className={cn(CARD_CLASS, 'p-4 lg:p-6')}>
          <h2 className="mb-2 text-lg font-semibold tracking-[-0.02em] text-[#101728]">{t('metrics.tableTitle')}</h2>
          <ul className="divide-y divide-[#edf0f4]">
            {rows.map((row) => (
              <li key={`${row.postId}:${row.provider}:${row.externalId}`} className="flex items-center gap-3 py-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#f7f8fa]">
                  <ProviderIcon provider={row.provider} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#101728]">{row.scriptAngle ?? t('metrics.noAngle')}</p>
                  <p className="truncate text-xs text-[#718096]">
                    {personaLabel(row.personaId)} · {accountLabels.get(row.accountId) ?? row.accountId}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-base font-bold tabular-nums text-[#101728]">
                    {row[metric] === null ? t('metrics.notReported') : formatNumber(row[metric])}
                  </p>
                  <p className="text-[11px] font-medium tracking-wide text-[#718096] uppercase">{metricLabel}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

interface SegmentedProps<T extends string> {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}

function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>): React.ReactElement {
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-xl bg-[#eef1f4] p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            'shrink-0 rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors',
            value === option.value ? 'bg-white text-[#101728] shadow-sm' : 'text-[#718096] hover:text-[#101728]',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}

function FilterSelect({ label, value, onChange, children }: FilterSelectProps): React.ReactElement {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold text-[#718096]">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className={SELECT_CLASS}>
        {children}
      </select>
    </label>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }): React.ReactElement {
  return (
    <div className={cn(CARD_CLASS, 'p-4')}>
      <p className="text-xs font-semibold text-[#718096]">{label}</p>
      <p className="mt-1 truncate text-2xl font-bold tracking-[-0.03em] text-[#101728]">{value}</p>
      {hint !== undefined && <p className="text-xs tabular-nums text-[#718096]">{hint}</p>}
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
      className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[#e3e8ee] bg-[#fafbfc] px-6 py-14 text-center"
    >
      <span className={cn(
        'flex size-11 items-center justify-center rounded-full [&>svg]:size-5',
        tone === 'error' ? 'bg-red-50 text-red-600' : 'bg-white text-[#718096] shadow-sm',
      )}>
        {tone === 'error' ? <AlertIcon /> : <ChartIcon />}
      </span>
      <p className="max-w-md text-sm text-[#4a5568]">{message}</p>
      {action}
    </div>
  );
}
