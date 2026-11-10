'use client';

import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';
import { ProviderIcon } from '@/components/provider-icon';
import { cn } from '@/lib/utils';
import {
  METRICS_ROW_LIMIT,
  type CoverageItem,
  type CoverageReason,
  type MetricsWindow,
} from '@/lib/metrics/metrics-query';

//---------------
// MetricsCoverageCard — the videos with no snapshot for the selected
// window (issue #525), grouped into "needs attention" (the window is open
// and collection keeps failing, the window closed, or the publish failed)
// and "waiting for their window" (not open yet). Rendered only when at
// least one video is missing, so a complete window stays quiet.
//---------------

// One const per leaf (not an inline object literal): v8 coverage does not
// report object-literal property lines, so this keeps every label visible
// to the coverage gate.
const pendingLabel: TranslationKey = 'metrics.coverageReasonPending';
const retryingLabel: TranslationKey = 'metrics.coverageReasonRetrying';
const missedLabel: TranslationKey = 'metrics.coverageReasonMissed';
const noTargetLabel: TranslationKey = 'metrics.coverageReasonNoTarget';
const publishFailedLabel: TranslationKey = 'metrics.coverageReasonPublishFailed';
const REASON_LABEL_KEYS: Record<CoverageReason, TranslationKey> = { pending: pendingLabel, retrying: retryingLabel, missed: missedLabel, 'no-target': noTargetLabel, 'publish-failed': publishFailedLabel };

const pendingChipClass = 'bg-surface text-muted-text';
const retryingChipClass = 'bg-warning-soft text-warning';
const missedChipClass = 'bg-destructive-soft text-destructive';
const noTargetChipClass = 'bg-destructive-soft text-destructive';
const publishFailedChipClass = 'bg-warning-soft text-warning';
const REASON_CHIP_CLASS: Record<CoverageReason, string> = { pending: pendingChipClass, retrying: retryingChipClass, missed: missedChipClass, 'no-target': noTargetChipClass, 'publish-failed': publishFailedChipClass };

const ATTENTION_REASONS: ReadonlySet<CoverageReason> = new Set(['retrying', 'missed', 'no-target', 'publish-failed']);

interface MetricsCoverageCardProps {
  items: CoverageItem[];
  truncated: boolean;
  window: MetricsWindow;
  personaLabel: (id: string | null) => string;
  accountLabel: (id: string) => string;
  formatDateTime: (iso: string) => string;
}

export function MetricsCoverageCard({
  items,
  truncated,
  window,
  personaLabel,
  accountLabel,
  formatDateTime,
}: MetricsCoverageCardProps): React.ReactElement {
  const { t } = useI18n();
  const attention = items.filter((item) => ATTENTION_REASONS.has(item.reason));
  const waiting = items.filter((item) => item.reason === 'pending');
  return (
    <section className="rounded-2xl border border-hairline bg-card p-4 shadow-[0_8px_24px_rgba(20,32,51,0.04)] lg:p-6">
      <h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">{t('metrics.coverageTitle')}</h2>
      <p className="mt-0.5 text-sm text-muted-text">
        {t('metrics.coverageSummary', { count: items.length, window })}
      </p>
      {attention.length > 0 && (
        <CoverageGroup
          title={t('metrics.coverageAttentionTitle')}
          items={attention}
          personaLabel={personaLabel}
          accountLabel={accountLabel}
          formatDateTime={formatDateTime}
        />
      )}
      {waiting.length > 0 && (
        <CoverageGroup
          title={t('metrics.coverageWaitingTitle')}
          items={waiting}
          personaLabel={personaLabel}
          accountLabel={accountLabel}
          formatDateTime={formatDateTime}
        />
      )}
      {truncated && (
        <p className="mt-3 text-xs text-muted-text">{t('metrics.truncated', { limit: METRICS_ROW_LIMIT })}</p>
      )}
    </section>
  );
}

interface CoverageGroupProps {
  title: string;
  items: CoverageItem[];
  personaLabel: (id: string | null) => string;
  accountLabel: (id: string) => string;
  formatDateTime: (iso: string) => string;
}

function CoverageGroup({ title, items, personaLabel, accountLabel, formatDateTime }: CoverageGroupProps): React.ReactElement {
  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold tracking-wide text-muted-text uppercase">{title}</h3>
      <ul className="divide-y divide-hairline">
        {items.map((item) => (
          <CoverageItemRow
            key={`${item.postId}:${item.provider}:${item.accountId}:${item.externalId ?? 'failed'}`}
            item={item}
            personaLabel={personaLabel}
            accountLabel={accountLabel}
            formatDateTime={formatDateTime}
          />
        ))}
      </ul>
    </div>
  );
}

interface CoverageItemRowProps {
  item: CoverageItem;
  personaLabel: (id: string | null) => string;
  accountLabel: (id: string) => string;
  formatDateTime: (iso: string) => string;
}

function CoverageItemRow({ item, personaLabel, accountLabel, formatDateTime }: CoverageItemRowProps): React.ReactElement {
  const { t } = useI18n();
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface">
          <ProviderIcon provider={item.provider} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{item.scriptAngle ?? t('metrics.noAngle')}</p>
          <p className="truncate text-xs text-muted-text">
            {personaLabel(item.personaId)} · {accountLabel(item.accountId)}
          </p>
        </div>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', REASON_CHIP_CLASS[item.reason])}>
          {t(REASON_LABEL_KEYS[item.reason])}
        </span>
      </div>
      <p className="pl-13 text-xs text-muted-text">
        {t('metrics.coverageWindow', { opens: formatDateTime(item.windowOpensAt), closes: formatDateTime(item.windowClosesAt) })}
      </p>
      {item.provider === 'youtube' && (item.reason === 'retrying' || item.reason === 'missed') && (
        <p className="pl-13 text-xs text-warning">{t('metrics.coverageYoutubeHint')}</p>
      )}
      {item.reason === 'publish-failed' && (
        <p className="pl-13 text-xs text-muted-text">{t('metrics.coveragePublishFailedHint')}</p>
      )}
    </li>
  );
}
