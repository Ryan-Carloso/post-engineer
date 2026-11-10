'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import { SpinnerIcon } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { ProviderIcon } from '@/components/provider-icon';
import { RetentionCurveChart } from '@/components/ui/retention-curve-chart';
import type { MetricsRowView } from '@/lib/metrics/metrics-query';
import { useRetentionCurveQuery } from '@/lib/metrics/metrics-dashboard';

//---------------
// MetricsRow — one measured video in the metrics list: views as the
// main number, likes/comments/saves inline as small numbers, and, for
// YouTube, the Analytics retention line (engaged views, derived Stayed
// to watch, provisional chip) plus an on-demand retention curve for
// long-form videos.
//---------------

const AMBER_CHIP = 'rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning';

interface MetricsRowProps {
  row: MetricsRowView;
  title: string;
  subtitle: string;
  formatNumber: (value: number) => string;
  formatDate: (iso: string) => string;
}

export function MetricsRow({ row, title, subtitle, formatNumber, formatDate }: MetricsRowProps): React.ReactElement {
  const { t } = useI18n();
  const engagement = [
    row.likes === null ? null : t('metrics.likesValue', { count: formatNumber(row.likes) }),
    row.comments === null ? null : t('metrics.commentsValue', { count: formatNumber(row.comments) }),
    row.saves === null ? null : t('metrics.savesValue', { count: formatNumber(row.saves) }),
  ].filter((value): value is string => value !== null);
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface">
          <ProviderIcon provider={row.provider} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{title}</p>
          <p className="truncate text-xs text-muted-text">{subtitle}</p>
          <p className="text-[11px] text-muted-text">
            {t('metrics.tableCollected')} {formatDate(row.collectedAt)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-base font-bold text-ink tabular-nums">
            {row.views === null ? t('metrics.notReported') : formatNumber(row.views)}
          </p>
          <p className="text-[11px] font-medium tracking-wide text-muted-text uppercase">{t('metrics.viewsLabel')}</p>
          {engagement.length > 0 && (
            <p className="mt-0.5 text-[11px] text-muted-text tabular-nums">{engagement.join(' · ')}</p>
          )}
        </div>
      </div>
      {row.provider === 'youtube' && row.analyticsStatus !== null && <RetentionLine row={row} formatNumber={formatNumber} />}
    </li>
  );
}

function RetentionLine({ row, formatNumber }: Pick<MetricsRowProps, 'row' | 'formatNumber'>): React.ReactElement {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (row.analyticsStatus === 'scope_missing') {
    // "—", never a zero: the numbers are unknown until the user reconnects.
    return (
      <p className="pl-13 text-xs text-muted-text">
        — <span className={AMBER_CHIP}>{t('metrics.reconnectNeeded')}</span>
      </p>
    );
  }
  if (row.analyticsStatus !== 'ok') {
    return <p className="pl-13 text-xs text-muted-text">{t('metrics.retentionUnavailable')}</p>;
  }
  const isLongForm = row.contentType === 'VIDEO_ON_DEMAND';
  return (
    <div className="flex flex-col gap-2 pl-13">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
        {row.engagedViews !== null && (
          <span className="tabular-nums">{t('metrics.engagedViewsValue', { count: formatNumber(row.engagedViews) })}</span>
        )}
        <span className="tabular-nums">
          {t('metrics.stayedToWatchDerived')}:{' '}
          <strong className="font-semibold text-ink">
            {row.stayedToWatchPct === null ? t('metrics.notReported') : `${formatNumber(row.stayedToWatchPct)}%`}
          </strong>
        </span>
        {row.provisional && <span className={AMBER_CHIP} title={t('metrics.provisionalHint')}>{t('metrics.provisional')}</span>}
        {isLongForm && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            className="font-semibold text-ink underline-offset-4 hover:underline"
          >
            {t(open ? 'metrics.curveHide' : 'metrics.curveShow')}
          </button>
        )}
      </div>
      {row.contentType === 'SHORTS' && <p className="text-[11px] text-muted-text">{t('metrics.curveShortsNote')}</p>}
      {isLongForm && open && <RetentionCurvePanel accountId={row.accountId} videoId={row.externalId} />}
    </div>
  );
}

function RetentionCurvePanel({ accountId, videoId }: { accountId: string; videoId: string }): React.ReactElement {
  const { t } = useI18n();
  const curve = useRetentionCurveQuery(accountId, videoId, true);
  const result = curve.data;
  let body: React.ReactNode;
  if (curve.isLoading) {
    body = <p className="flex items-center gap-2 text-xs text-muted-text"><SpinnerIcon />{t('metrics.curveLoading')}</p>;
  } else if (curve.isError || result === undefined) {
    const reconnect = curve.isError && curve.error.reconnect;
    body = (
      <p role="alert" className={cn('text-xs', reconnect ? 'text-warning' : 'text-destructive')}>
        {t(reconnect ? 'metrics.reconnectTitle' : 'metrics.curveError')}
      </p>
    );
  } else if (result.points.length === 0) {
    body = <p className="text-xs text-muted-text">{t('metrics.curveEmpty')}</p>;
  } else {
    body = (
      <RetentionCurveChart
        points={result.points}
        watchingLabel={t('metrics.curveWatching')}
        relativeLabel={t('metrics.curveRelative')}
        axisLabel={(percent) => t('metrics.curveAxis', { percent })}
      />
    );
  }
  return <div className="rounded-xl border border-hairline bg-surface p-3">{body}</div>;
}
