'use client';

import { useI18n } from '@/lib/i18n/provider';

//---------------
// Loading skeletons for the posts pages: the calendar grid shape on /posts
// (CalendarLoadingSkeleton), plain card grids on /posts/history
// (CardsLoadingSkeleton). A skeleton keeps the page layout in place while
// the queries load, instead of a lone spinner on an empty page.
// role="status" announces the loading text to screen readers; the shapes
// themselves are aria-hidden.
//---------------

export function CalendarLoadingSkeleton() {
  const { t } = useI18n();
  return (
    <div role="status">
      <span className="sr-only">{t('posts.loadingPosts')}</span>
      <div aria-hidden className="rounded-xl border border-line bg-card p-2 sm:p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="size-8 animate-pulse rounded-md bg-sunken" />
          <div className="h-5 w-32 animate-pulse rounded bg-sunken" />
          <div className="size-8 animate-pulse rounded-md bg-sunken" />
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={`weekday-${i}`} className="h-4 animate-pulse rounded bg-sunken" />
          ))}
          {Array.from({ length: 42 }, (_, i) => (
            <div key={`day-${i}`} className="h-12 animate-pulse rounded-md bg-sunken sm:h-16" />
          ))}
        </div>
      </div>
      <div aria-hidden className="mt-6">
        <div className="h-5 w-64 animate-pulse rounded bg-sunken" />
        <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={`card-${i}`} className="h-36 animate-pulse rounded-xl bg-sunken" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function CardsLoadingSkeleton() {
  const { t } = useI18n();
  return (
    <div role="status">
      <span className="sr-only">{t('posts.loadingPosts')}</span>
      <div aria-hidden>
        <div className="h-5 w-48 animate-pulse rounded bg-sunken" />
        <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={`card-${i}`} className="h-36 animate-pulse rounded-xl bg-sunken" />
          ))}
        </div>
      </div>
    </div>
  );
}
