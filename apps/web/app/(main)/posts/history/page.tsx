'use client';

import { useMemo } from 'react';
import { useScheduleStatusQuery, useVideoGenerationsQuery } from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';
import { GenerationCard } from '../post-card';
import { CardsLoadingSkeleton } from '../loading-skeleton';
import { PostFiltersBar, SlotCard, usePostFilters, usePostJoins } from '../post-joins';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';

//---------------
// PostHistoryPage — past posts and video generations as a list, across all
// connected accounts. Read-only: GET /api/schedule/status with a raised
// limit (its `recent` half) plus the generations list. The month view of
// the same posts is the calendar on /posts.
//---------------

// Max rows fetched; the API caps ?limit= at 500, the page asks for fewer to
// keep the render cheap. Exported for tests.
export const POSTS_LIMIT = 200;

export default function PostHistoryPage() {
  const { t, locale } = useI18n();
  const statusQuery = useScheduleStatusQuery(POSTS_LIMIT);
  const generationsQuery = useVideoGenerationsQuery(POSTS_LIMIT);
  const joins = usePostJoins();
  const filters = usePostFilters(joins);

  // Slots whose schedule was deleted are dropped (they fail the filter), so
  // the capped hint counts the fetched rows, not the visible ones.
  const recent = useMemo(() => statusQuery.data?.recent ?? [], [statusQuery.data]);
  const visibleSlots = useMemo(() => recent.filter(filters.passes), [recent, filters.passes]);
  const generations = generationsQuery.data ?? [];

  const isLoading = statusQuery.isLoading || generationsQuery.isLoading || joins.isLoading;
  const isError = statusQuery.isError || generationsQuery.isError || joins.isError;
  // The error names what failed — the history list, the generations, or
  // the supporting data behind the cards — never an internal detail.
  const loadErrorKey: TranslationKey = statusQuery.isError
    ? 'posts.loadErrorHistory'
    : generationsQuery.isError
      ? 'posts.loadErrorGenerations'
      : 'posts.loadErrorSupporting';
  // The error state covers every query, so retry refetches all of them — a
  // failed query would otherwise never clear without a full page reload.
  const handleRetry = () => {
    void statusQuery.refetch();
    void generationsQuery.refetch();
    joins.refetch();
  };
  // The fetch truncates at POSTS_LIMIT rows; say so instead of implying the
  // list is complete, even when a filter narrows the visible rows.
  const isCapped = recent.length >= POSTS_LIMIT;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t('posts.historyTitle')}
        description={t('posts.historySubtitle')}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRetry}
            disabled={statusQuery.isFetching}
          >
            {t('posts.refresh')}
          </Button>
        }
      />

      {isCapped && !isLoading && !isError && (
        <p className="mt-3 text-xs text-muted-foreground">{t('posts.listCapped', { count: POSTS_LIMIT })}</p>
      )}

      <PostFiltersBar filters={filters} />

      <div className="mt-6">
        {isLoading ? (
          <CardsLoadingSkeleton />
        ) : isError ? (
          <div className="rounded-xl border border-input bg-card p-8 text-center">
            <p className="text-sm font-semibold text-primary">{t(loadErrorKey)}</p>
            <Button type="button" size="sm" onClick={handleRetry} className="mt-3">
              {t('posts.refresh')}
            </Button>
          </div>
        ) : (
          <>
            <section aria-label={t('posts.generationsTitle')} className="mb-8">
              <h2 className="text-base font-bold tracking-[-0.01em] text-primary">{t('posts.generationsTitle')}</h2>
              {generations.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">{t('posts.generationsEmpty')}</p>
              ) : (
                <div className="mt-3 flex flex-col gap-2.5">
                  {generations.map((generation) => (
                    <GenerationCard key={generation.id} generation={generation} locale={locale} />
                  ))}
                </div>
              )}
            </section>
            <section aria-label={t('posts.historyPostsTitle')}>
              <h2 className="text-base font-bold tracking-[-0.01em] text-primary">{t('posts.historyPostsTitle')}</h2>
              {visibleSlots.length === 0 ? (
                <div className="mt-3 rounded-xl border border-dashed border-line bg-card px-6 py-8 text-center text-sm text-muted-foreground">
                  {filters.hasActiveFilter ? t('posts.noResultsForFilter') : t('posts.noHistory')}
                </div>
              ) : (
                <div className="mt-3 flex flex-col gap-2.5">
                  {visibleSlots.map((slot) => (
                    <SlotCard key={slot.id} slot={slot} joins={joins} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
