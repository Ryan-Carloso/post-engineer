'use client';

import type { ReactNode } from 'react';
import HeaderLocaleSwitcher from '@/app/landing/header-locale-switcher';
import { STATUS_KEY, STATUS_STYLE } from '@/app/(main)/posts/status';
import AppLogo from '@/components/ui/app-logo';
import { CARD_CLASS, StatTile } from '@/components/ui/stat-tile';
import { ProviderIcon } from '@/components/provider-icon';
import { PROVIDER_LABELS } from '@/lib/account-options';
import { useI18n } from '@/lib/i18n/provider';
import { METRICS_ROW_LIMIT } from '@/lib/metrics/metrics-query';
import { SHARE_POSTS_LIMIT, type SharePost, type ShareView } from '@/lib/share-links/share-view-types';
import { cn } from '@/lib/utils';

const DAY_MS = 24 * 60 * 60 * 1000;

function Shell({ children }: { children: ReactNode }): ReactNode {
  const { t } = useI18n();
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 lg:py-10">
        <header className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <AppLogo size={36} />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold tracking-[-0.03em] text-ink">{t('sharedView.title')}</h1>
              <span className="mt-0.5 inline-flex rounded-full bg-sunken px-2 py-0.5 text-[11px] font-semibold text-muted-text">
                {t('sharedView.readOnly')}
              </span>
            </div>
          </div>
          <HeaderLocaleSwitcher />
        </header>
        {children}
      </main>
      <footer className="px-4 py-6 text-center text-xs text-muted-text">{t('sharedView.footer')}</footer>
    </div>
  );
}

export function SharedRateLimited(): ReactNode {
  const { t } = useI18n();
  return (
    <Shell>
      <p role="status" data-testid="shared-rate-limited" className={cn(CARD_CLASS, 'p-6 text-sm text-ink-soft')}>
        {t('sharedView.rateLimited')}
      </p>
    </Shell>
  );
}

function PostRow({ post, formatDateTime }: { post: SharePost; formatDateTime: (iso: string) => string }): ReactNode {
  const { t } = useI18n();
  return (
    <li className="flex items-start justify-between gap-3 py-3" data-testid="shared-post-row">
      <div className="min-w-0">
        <p className="line-clamp-2 text-sm font-semibold break-words text-ink">{post.title ?? t('sharedView.untitled')}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-text">
          <time dateTime={post.slotAt} suppressHydrationWarning>
            {formatDateTime(post.slotAt)}
          </time>
          <span className="flex items-center gap-1.5">
            {post.providers.map((provider) => (
              <span key={provider} title={PROVIDER_LABELS[provider]} className="inline-flex items-center [&>svg]:size-4">
                <ProviderIcon provider={provider} />
                <span className="sr-only">{PROVIDER_LABELS[provider]}</span>
              </span>
            ))}
          </span>
        </p>
      </div>
      <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold', STATUS_STYLE[post.status])}>
        {t(STATUS_KEY[post.status])}
      </span>
    </li>
  );
}

export function SharedMetricsView({ view }: { view: ShareView }): ReactNode {
  const { t, locale } = useI18n();
  const intlLocale = locale === 'pt' ? 'pt-BR' : 'en-US';
  const formatNumber = (value: number): string => value.toLocaleString(intlLocale);
  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString(intlLocale, { dateStyle: 'medium', timeZone: 'UTC' });
  const formatDateTime = (iso: string): string =>
    new Date(iso).toLocaleString(intlLocale, { dateStyle: 'medium', timeStyle: 'short' });
  const lastWeekday = new Date(Date.parse(view.weekEnd) - DAY_MS).toISOString();

  return (
    <Shell>
      <section className={cn(CARD_CLASS, 'flex flex-col gap-4 p-4 lg:p-5')} data-testid="shared-metrics">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">{t('sharedView.metricsTitle')}</h2>
          <p className="mt-0.5 text-xs text-muted-text">{t('sharedView.metricsCaption')}</p>
          {view.asOf !== null && (
            <p className="mt-0.5 text-xs text-muted-text" suppressHydrationWarning>
              {t('sharedView.asOf', { date: formatDateTime(view.asOf) })}
            </p>
          )}
        </div>
        {view.summary.measurements === 0 ? (
          <p className="rounded-xl border border-dashed border-line bg-surface px-4 py-8 text-center text-sm text-ink-soft">
            {t('sharedView.metricsEmpty')}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatTile label={t('sharedView.statMeasurements')} value={formatNumber(view.summary.measurements)} />
              <StatTile label={t('sharedView.statViews')} value={formatNumber(view.summary.views)} />
              <StatTile label={t('sharedView.statEngagement')} value={formatNumber(view.summary.engagement)} />
            </div>
            <div>
              <h3 className="mb-1 text-xs font-semibold text-muted-text">{t('sharedView.byNetwork')}</h3>
              <ul className="divide-y divide-hairline">
                {view.byProvider.map((entry) => (
                  <li key={entry.provider} className="flex items-center justify-between gap-3 py-2.5" data-testid="shared-provider-row">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                      <span className="inline-flex [&>svg]:size-5">
                        <ProviderIcon provider={entry.provider} />
                      </span>
                      <span className="truncate">{PROVIDER_LABELS[entry.provider]}</span>
                    </span>
                    <span className="shrink-0 text-right text-xs text-muted-text tabular-nums">
                      <span className="block text-sm font-semibold text-ink">{formatNumber(entry.views)}</span>
                      {t('sharedView.measurementsCount', { count: formatNumber(entry.measurements) })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
        {view.metricsTruncated && (
          <p className="text-xs text-muted-text">{t('sharedView.metricsTruncated', { limit: METRICS_ROW_LIMIT })}</p>
        )}
      </section>

      <section className={cn(CARD_CLASS, 'p-4 lg:p-5')} data-testid="shared-posts">
        <h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">{t('sharedView.postsTitle')}</h2>
        <p className="mt-0.5 text-xs text-muted-text" suppressHydrationWarning>
          {t('sharedView.postsRange', { from: formatDate(view.weekStart), to: formatDate(lastWeekday) })}
        </p>
        {view.posts.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-line bg-surface px-4 py-8 text-center text-sm text-ink-soft">
            {t('sharedView.postsEmpty')}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-hairline">
            {view.posts.map((post, index) => (
              <PostRow key={`${post.slotAt}:${index}`} post={post} formatDateTime={formatDateTime} />
            ))}
          </ul>
        )}
        {view.postsTruncated && (
          <p className="mt-3 text-xs text-muted-text">{t('sharedView.postsTruncated', { limit: SHARE_POSTS_LIMIT })}</p>
        )}
      </section>
    </Shell>
  );
}
