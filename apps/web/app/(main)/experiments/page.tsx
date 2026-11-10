'use client';

import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import { AlertIcon, ChartIcon, SpinnerIcon } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { PROVIDER_LABELS } from '@/lib/account-options';
import { isSocialProvider } from '@/lib/providers/registry';
import {
  useExperimentDetailQuery,
  useExperimentsQuery,
  type ExperimentDetailResult,
  type ExperimentProviderResult,
  type ExperimentsWindow,
} from '@/lib/experiments/experiments-dashboard';
import type { ExperimentResultLabel } from '@/lib/experiments/results';

//---------------
// ExperimentsPage — A/B experiment results (issue #532), separate from
// /metrics: metrics answers "how did videos do at the same age",
// experiments answer "which hook won". Live from publish until 7d after
// publish, then frozen; window toggle 24h / 7d, no 28d.
//
// Variants are shown by human name only — never A/B letters. Comparisons
// are per provider, never across providers, and a winner is only called
// when the label is clear.
//---------------

const CARD_CLASS = 'rounded-2xl border border-hairline bg-card shadow-[0_8px_24px_rgba(20,32,51,0.04)]';
const SELECT_CLASS =
  "w-full appearance-none rounded-xl border border-line bg-card bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23718096'%3E%3Cpath d='M5.5 7.5 10 12l4.5-4.5'/%3E%3C/svg%3E\")] bg-[length:16px] bg-[right_10px_center] bg-no-repeat py-2.5 pr-9 pl-3 text-sm font-medium text-ink transition-colors hover:border-line focus:border-ink focus:ring-2 focus:ring-ink/10 focus:outline-none";
const WINDOWS: ExperimentsWindow[] = ['24h', '7d'];

const LABEL_BADGE_CLASS: Record<ExperimentResultLabel, string> = {
  pending: 'bg-surface text-muted-text',
  indicative: 'bg-warning-soft text-warning',
  clear: 'bg-success-soft text-success',
};

export default function ExperimentsPage(): React.ReactElement {
  const { t, locale } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [window, setWindow] = useState<ExperimentsWindow>('7d');

  const listQuery = useExperimentsQuery();
  const experiments = useMemo(
    () => (listQuery.data !== undefined && listQuery.data.success ? listQuery.data.experiments : []),
    [listQuery.data],
  );
  // Default to the newest experiment once the list loads.
  useEffect(() => {
    if (selectedId === null && experiments.length > 0) setSelectedId(experiments[0].id);
  }, [selectedId, experiments]);

  const detailQuery = useExperimentDetailQuery(selectedId, window);
  const detail = detailQuery.data !== undefined && detailQuery.data.success ? detailQuery.data : null;
  const failed = listQuery.isError
    || (listQuery.data !== undefined && !listQuery.data.success)
    || detailQuery.isError
    || (detailQuery.data !== undefined && !detailQuery.data.success);

  const formatNumber = (value: number): string => value.toLocaleString(locale === 'pt' ? 'pt-BR' : 'en-US');
  const formatDateTime = (iso: string): string =>
    new Date(iso).toLocaleString(locale === 'pt' ? 'pt-BR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="mx-auto flex w-full max-w-375 flex-col gap-5 lg:gap-6">
      <header className="flex items-center gap-4 py-1 lg:py-2">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#17191c] text-white shadow-[0_8px_18px_rgba(16,23,40,0.14)] [&>svg]:size-6">
          <ChartIcon />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.035em] text-ink">{t('experiments.title')}</h1>
          <p className="mt-0.5 text-sm text-muted-text lg:text-base">{t('experiments.subtitle')}</p>
        </div>
      </header>

      <section className={cn(CARD_CLASS, 'flex flex-col gap-4 p-4 lg:p-5')}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 grow flex-col gap-1.5 text-xs font-semibold text-muted-text">
            {t('experiments.selectLabel')}
            <select
              value={selectedId ?? ''}
              onChange={(event) => setSelectedId(event.target.value === '' ? null : event.target.value)}
              className={SELECT_CLASS}
              disabled={listQuery.isLoading || experiments.length === 0}
            >
              <option value="">{t('experiments.selectPlaceholder')}</option>
              {experiments.map((experiment) => (
                <option key={experiment.id} value={experiment.id}>{experiment.name}</option>
              ))}
            </select>
          </label>
          <Segmented
            options={WINDOWS.map((value) => ({ value, label: t(value === '24h' ? 'experiments.window24h' : 'experiments.window7d') }))}
            value={window}
            onChange={setWindow}
          />
        </div>
      </section>

      {listQuery.isLoading || (selectedId !== null && detailQuery.isLoading) ? (
        <div className="flex items-center justify-center py-20 text-muted-text"><SpinnerIcon /></div>
      ) : failed ? (
        <StatePanel tone="error" message={t('experiments.loadError')}
          action={<button type="button" onClick={() => { void listQuery.refetch(); void detailQuery.refetch(); }}
            disabled={listQuery.isFetching || detailQuery.isFetching}
            className="rounded-xl border border-line bg-card px-4 py-2 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-50">
            {t('experiments.retry')}
          </button>} />
      ) : experiments.length === 0 ? (
        <StatePanel tone="empty" message={t('experiments.empty')} />
      ) : detail === null ? (
        <StatePanel tone="empty" message={t('experiments.emptyDetail')} />
      ) : (
        <ExperimentDetail detail={detail} formatNumber={formatNumber} formatDateTime={formatDateTime} />
      )}
    </div>
  );
}

function ExperimentDetail({ detail, formatNumber, formatDateTime }: {
  detail: ExperimentDetailResult;
  formatNumber: (value: number) => string;
  formatDateTime: (iso: string) => string;
}): React.ReactElement {
  const { t } = useI18n();
  const [first, second] = detail.experiment.variants;
  const variantName = (variantId: string): string =>
    detail.experiment.variants.find((variant) => variant.variantId === variantId)?.name ?? variantId;
  const badgeKey = detail.frozen
    ? 'experiments.frozenBadge'
    : detail.source === 'live'
      ? 'experiments.liveBadge'
      : detail.source === 'partial'
        ? 'experiments.partialBadge'
        : 'experiments.snapshotBadge';
  return (
    <>
      <section className={cn(CARD_CLASS, 'flex flex-col gap-2 p-4 lg:p-5')}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn(
            'rounded-full px-3 py-1 text-xs font-semibold',
            detail.frozen ? 'bg-surface text-muted-text' : detail.source === 'snapshot' ? 'bg-surface text-muted-text' : detail.source === 'partial' ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success',
          )}>
            {t(badgeKey)}
          </span>
          {detail.liveAt !== null && (
            <p className="text-xs text-muted-text">{t('experiments.updatedAt', { date: formatDateTime(detail.liveAt) })}</p>
          )}
        </div>
        <p className="text-sm text-ink">
          {t('experiments.pairsPlanned', { published: detail.results.pairsPublished, target: detail.results.targetPairs })}
        </p>
        {detail.liveFailures.length > 0 && (
          <p className="text-xs text-warning">{t('experiments.liveFailures', { count: detail.liveFailures.length })}</p>
        )}
      </section>

      {detail.results.providers.length === 0 ? (
        <StatePanel tone="empty" message={t('experiments.emptyDetail')} />
      ) : (
        detail.results.providers.map((provider) => (
          <ProviderCard
            key={provider.provider}
            provider={provider}
            firstName={first.name}
            secondName={second.name}
            firstId={first.variantId}
            secondId={second.variantId}
            variantName={variantName}
            pairsCreated={detail.results.pairsCreated}
            formatNumber={formatNumber}
          />
        ))
      )}
    </>
  );
}

function ProviderCard({ provider, firstName, secondName, firstId, secondId, variantName, pairsCreated, formatNumber }: {
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
  const labelKey = provider.label === 'clear'
    ? 'experiments.labelClear'
    : provider.label === 'indicative'
      ? 'experiments.labelIndicative'
      : 'experiments.labelPending';
  const winsFirst = provider.wins[firstId] ?? 0;
  const winsSecond = provider.wins[secondId] ?? 0;
  return (
    <section className={cn(CARD_CLASS, 'p-4 lg:p-6')}>
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
      <table className="mt-4 w-full text-sm">
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
            const comparison = provider.comparisons.find((entry) => entry.pair === pair);
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
    </section>
  );
}

interface SegmentedProps<T extends string> {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}

function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>): React.ReactElement {
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-xl bg-sunken p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            'shrink-0 rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors',
            value === option.value ? 'bg-card text-ink shadow-sm' : 'text-muted-text hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
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
