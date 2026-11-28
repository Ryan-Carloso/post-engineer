'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, FlaskConical } from 'lucide-react';
import { ProviderIcon } from '@/components/provider-icon';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { accountOption } from '@/lib/account-options';
import { useSocialAccountsQuery } from '@/lib/api';
import type { PromptComparisonResponse } from '@/lib/contracts/experiments';
import { METRICS_WINDOWS, type MetricsWindow } from '@/lib/contracts/metrics';
import { COMPARISON_ROW_LIMIT } from '@/lib/experiments/comparison-limits';
import { usePromptComparisonQuery } from '@/lib/experiments/comparison-query';
import { MIN_COMPARED_VIDEOS, RECOMMENDED_VIDEOS_PER_PROMPT } from '@/lib/experiments/prompt-comparison';
import type { TranslationKey } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/provider';
import { isSocialProvider } from '@/lib/providers/registry';
import { SpinnerIcon } from '@/lib/ui';
import { cn } from '@/lib/utils';

type AccountView = PromptComparisonResponse['accounts'][number];
type PromptView = AccountView['prompts'][number];

const CARD_CLASS = 'rounded-2xl border border-hairline bg-card shadow-[0_8px_24px_rgba(20,32,51,0.04)]';

const WINDOW_LABEL_KEYS: Record<MetricsWindow, TranslationKey> = {
  '24h': 'experiments.window24h',
  '7d': 'experiments.window7d',
  '28d': 'experiments.window28d',
};

const LABEL_KEYS: Record<PromptView['label'], TranslationKey> = {
  insufficient: 'experiments.labelInsufficient',
  no_signal: 'experiments.labelNoSignal',
  indicative: 'experiments.labelIndicative',
  clear: 'experiments.labelClear',
};

function labelTone(prompt: PromptView): string {
  if (prompt.label === 'clear') return prompt.direction === 'below' ? 'bg-destructive-soft text-destructive' : 'bg-success-soft text-success';
  if (prompt.label === 'indicative') return 'bg-warning-soft text-warning';
  return 'bg-surface text-muted-text';
}

export function ExperimentsView(): React.ReactElement {
  const { t, locale } = useI18n();
  const [window, setWindow] = useState<MetricsWindow>('7d');
  const query = usePromptComparisonQuery(window);
  const accountsQuery = useSocialAccountsQuery();
  const accountLabels = useMemo(
    () => new Map((accountsQuery.data?.accounts ?? []).map(accountOption).map((account) => [account.id, account.label])),
    [accountsQuery.data],
  );
  const result = query.data;
  const failed = query.isError || (result !== undefined && !result.success);
  const formatNumber = (value: number, digits = 0): string =>
    value.toLocaleString(locale === 'pt' ? 'pt-BR' : 'en-US', { maximumFractionDigits: digits });

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <section className={cn(CARD_CLASS, 'flex flex-col gap-3 p-4 lg:p-5')}>
        <Tabs
          value={window}
          onValueChange={(value) => {
            const match = METRICS_WINDOWS.find((candidate) => candidate === value);
            if (match !== undefined) setWindow(match);
          }}
        >
          <TabsList>
            {METRICS_WINDOWS.map((value) => (
              <TabsTrigger key={value} value={value}>{t(WINDOW_LABEL_KEYS[value])}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <p className="text-xs text-muted-text">{t('experiments.howItWorks', { min: MIN_COMPARED_VIDEOS, recommended: RECOMMENDED_VIDEOS_PER_PROMPT })}</p>
      </section>

      {query.isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-text"><SpinnerIcon /></div>
      ) : failed || result === undefined || !result.success ? (
        <EmptyState
          icon={AlertTriangle}
          title={t('experiments.title')}
          description={t('experiments.loadError')}
          action={(
            <button
              type="button"
              onClick={() => { void query.refetch(); }}
              disabled={query.isFetching}
              className="rounded-xl border border-line bg-card px-4 py-2 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-50"
            >
              {t('experiments.retry')}
            </button>
          )}
        />
      ) : result.accounts.length === 0 ? (
        <EmptyState icon={FlaskConical} title={t('experiments.title')} description={t('experiments.empty')} />
      ) : (
        <>
          {result.truncated && (
            <p className="text-xs text-warning">{t('experiments.truncated', { count: formatNumber(COMPARISON_ROW_LIMIT) })}</p>
          )}
          {result.accounts.map((account) => (
            <AccountCard
              key={`${account.provider}:${account.accountId}`}
              account={account}
              accountLabel={accountLabels.get(account.accountId) ?? account.accountId}
              formatNumber={formatNumber}
            />
          ))}
        </>
      )}
    </div>
  );
}

function AccountCard({ account, accountLabel, formatNumber }: {
  account: AccountView;
  accountLabel: string;
  formatNumber: (value: number, digits?: number) => string;
}): React.ReactElement {
  const { t } = useI18n();
  return (
    <section className={cn(CARD_CLASS, 'flex flex-col gap-3 p-4 lg:p-5')} aria-label={accountLabel}>
      <header className="flex items-center gap-3">
        {isSocialProvider(account.provider) && (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sunken"><ProviderIcon provider={account.provider} /></span>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-ink">{accountLabel}</h2>
          <p className="text-xs text-muted-text">
            {t('experiments.accountSummary', {
              videos: account.videos,
              views: account.baselineViews === null ? '—' : formatNumber(account.baselineViews),
            })}
          </p>
        </div>
      </header>
      <ul className="flex flex-col divide-y divide-hairline">
        {account.prompts.map((prompt) => (
          <PromptRow key={prompt.versionId ?? 'none'} prompt={prompt} formatNumber={formatNumber} />
        ))}
      </ul>
    </section>
  );
}

function PromptRow({ prompt, formatNumber }: {
  prompt: PromptView;
  formatNumber: (value: number, digits?: number) => string;
}): React.ReactElement {
  const { t } = useI18n();
  const name = prompt.versionId === null ? t('experiments.noPrompt') : (prompt.title ?? prompt.slug ?? prompt.versionId);
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 grow basis-60">
        <p className="truncate text-sm font-semibold text-ink">{name}</p>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-text">
          {prompt.slug !== null && <span className="truncate">{prompt.slug}</span>}
          {prompt.version !== null && <span>{t('experiments.version', { version: prompt.version })}</span>}
          {prompt.source === 'official' && <Badge variant="outline">{t('experiments.official')}</Badge>}
          <span>{t('experiments.videos', { count: prompt.videos })}</span>
        </p>
      </div>
      <div className="flex items-center gap-4">
        <dl className="flex items-center gap-4 text-right">
          <div>
            <dt className="text-[11px] text-muted-text">{t('experiments.medianViews')}</dt>
            <dd className="text-sm font-semibold text-ink tabular-nums">{prompt.medianViews === null ? '—' : formatNumber(prompt.medianViews)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-text">{t('experiments.lift')}</dt>
            <dd className="text-sm font-semibold text-ink tabular-nums">
              {prompt.lift === null ? '—' : t('experiments.liftValue', { value: formatNumber(prompt.lift, 2) })}
            </dd>
          </div>
        </dl>
        <span
          className={cn('rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap', labelTone(prompt))}
          title={prompt.direction === null ? undefined : t(prompt.direction === 'above' ? 'experiments.above' : 'experiments.below')}
        >
          {t(LABEL_KEYS[prompt.label])}
        </span>
      </div>
    </li>
  );
}
