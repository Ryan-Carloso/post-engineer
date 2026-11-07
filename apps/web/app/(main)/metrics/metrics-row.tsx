'use client';

import { useI18n } from '@/lib/i18n/provider';
import { ProviderIcon } from '@/components/provider-icon';
import type { MetricsRowView } from '@/lib/metrics/metrics-query';
import type { MetricKey } from '@/lib/metrics/metrics-dashboard';

//---------------
// MetricsRow — one measured video in the metrics list: the selected metric
// on the right and, for YouTube, the Analytics retention line (engaged
// views, derived Stayed to watch, provisional chip).
//---------------

const AMBER_CHIP = 'rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700';

interface MetricsRowProps {
  row: MetricsRowView;
  metric: MetricKey;
  metricLabel: string;
  title: string;
  subtitle: string;
  formatMetric: (value: number, metric: MetricKey) => string;
}

export function MetricsRow({ row, metric, metricLabel, title, subtitle, formatMetric }: MetricsRowProps): React.ReactElement {
  const { t } = useI18n();
  const value = row[metric];
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#f7f8fa]">
          <ProviderIcon provider={row.provider} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[#101728]">{title}</p>
          <p className="truncate text-xs text-[#718096]">{subtitle}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-base font-bold text-[#101728] tabular-nums">
            {value === null ? t('metrics.notReported') : formatMetric(value, metric)}
          </p>
          <p className="text-[11px] font-medium tracking-wide text-[#718096] uppercase">{metricLabel}</p>
        </div>
      </div>
      {row.provider === 'youtube' && row.analyticsStatus !== null && <RetentionLine row={row} formatMetric={formatMetric} />}
    </li>
  );
}

function RetentionLine({ row, formatMetric }: Pick<MetricsRowProps, 'row' | 'formatMetric'>): React.ReactElement {
  const { t } = useI18n();
  if (row.analyticsStatus === 'scope_missing') {
    // "—", never a zero: the numbers are unknown until the user reconnects.
    return (
      <p className="pl-13 text-xs text-[#718096]">
        — <span className={AMBER_CHIP}>{t('metrics.reconnectNeeded')}</span>
      </p>
    );
  }
  if (row.analyticsStatus !== 'ok') {
    return <p className="pl-13 text-xs text-[#718096]">{t('metrics.retentionUnavailable')}</p>;
  }
  return (
    <div className="flex flex-col gap-2 pl-13">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#4a5568]">
        {row.engagedViews !== null && (
          <span className="tabular-nums">{t('metrics.engagedViewsValue', { count: formatMetric(row.engagedViews, 'engagedViews') })}</span>
        )}
        <span className="tabular-nums">
          {t('metrics.stayedToWatchDerived')}:{' '}
          <strong className="font-semibold text-[#101728]">
            {row.stayedToWatchPct === null ? t('metrics.notReported') : formatMetric(row.stayedToWatchPct, 'stayedToWatchPct')}
          </strong>
        </span>
        {row.provisional && <span className={AMBER_CHIP} title={t('metrics.provisionalHint')}>{t('metrics.provisional')}</span>}
      </div>
    </div>
  );
}
