'use client';

import { useI18n } from '@/lib/i18n/provider';

//---------------
// Loading skeletons for the posts pages: the calendar grid shape on /posts
// (CalendarLoadingSkeleton), plain card grids on /posts/history
// (CardsLoadingSkeleton). A skeleton keeps the page layout in place while
// the queries load, instead of a lone spinner on an empty page: it is the
// only visible loading cue (the loading text is for screen readers, via
// role="status"). The calendar skeleton has the shown month's number of
// weeks and the real page layout (side panel on wide screens). Shapes use
// the line token, not sunken: sunken on the white card was barely visible.
//---------------

const SHAPE = 'animate-pulse bg-line';

// Calendar + day panel side by side on wide screens (so the selected day's
// posts show without scrolling); shared by the page and its skeleton.
export const CALENDAR_LAYOUT_CLASS =
  'xl:grid xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start xl:gap-6 2xl:grid-cols-[minmax(0,1fr)_24rem]';

function LoadingLabel() {
  const { t } = useI18n();
  return <p className="sr-only">{t('posts.loadingPosts')}</p>;
}

export function CalendarLoadingSkeleton({ weeks }: { weeks: number }) {
  return (
    <div role="status" className={CALENDAR_LAYOUT_CLASS}>
      <LoadingLabel />
      <div aria-hidden data-skeleton-calendar className="rounded-xl border border-line bg-card p-2 sm:p-4">
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
          {Array.from({ length: weeks * 7 }, (_, i) => (
            <div key={`day-${i}`} data-skeleton-day className={`h-18 rounded-md opacity-60 sm:h-19 ${SHAPE}`} />
          ))}
        </div>
      </div>
      <div aria-hidden className="mt-6 xl:mt-0">
        <div className={`h-5 w-64 max-w-full rounded ${SHAPE}`} />
        <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          {Array.from({ length: 2 }, (_, i) => (
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
