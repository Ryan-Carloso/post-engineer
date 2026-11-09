'use client';

import { LoaderCircle } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';

//---------------
// Loading skeletons for the posts pages: the calendar grid shape on /posts
// (CalendarLoadingSkeleton), plain card grids on /posts/history
// (CardsLoadingSkeleton). A skeleton keeps the page layout in place while
// the queries load, instead of a lone spinner on an empty page. The
// loading text is visible (role="status" also announces it to screen
// readers); the shapes themselves are aria-hidden. Shapes use the line
// token, not sunken: sunken on the white card was barely visible.
//---------------

const SHAPE = 'animate-pulse bg-line';

function LoadingLabel() {
  const { t } = useI18n();
  return (
    <p className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      {t('posts.loadingPosts')}
    </p>
  );
}

export function CalendarLoadingSkeleton() {
  return (
    <div role="status">
      <LoadingLabel />
      <div aria-hidden className="rounded-xl border border-line bg-card p-2 sm:p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className={`h-5 w-32 rounded ${SHAPE}`} />
          <div className="flex gap-1">
            <div className={`size-10 rounded-md ${SHAPE}`} />
            <div className={`h-10 w-16 rounded-md ${SHAPE}`} />
            <div className={`size-10 rounded-md ${SHAPE}`} />
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={`weekday-${i}`} className={`h-4 rounded ${SHAPE}`} />
          ))}
          {Array.from({ length: 35 }, (_, i) => (
            <div key={`day-${i}`} className={`h-14 rounded-md opacity-60 sm:h-20 ${SHAPE}`} />
          ))}
        </div>
      </div>
      <div aria-hidden className="mt-6">
        <div className={`h-5 w-64 rounded ${SHAPE}`} />
        <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={`card-${i}`} className={`h-36 rounded-xl opacity-60 ${SHAPE}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function CardsLoadingSkeleton() {
  return (
    <div role="status">
      <LoadingLabel />
      <div aria-hidden>
        <div className={`h-5 w-48 rounded ${SHAPE}`} />
        <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={`card-${i}`} className={`h-36 rounded-xl opacity-60 ${SHAPE}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
