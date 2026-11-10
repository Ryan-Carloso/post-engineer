'use client';

import { useI18n } from '@/lib/i18n/provider';

//---------------
// Loading skeletons for the posts pages: the calendar grid shape on /posts
// (CalendarLoadingSkeleton), plain card grids on /posts/history
// (CardsLoadingSkeleton). A skeleton keeps the page layout in place while
// the queries load, instead of a lone spinner on an empty page: it is the
// visible loading cue (the loading text sits above the skeleton, and the
// region is role="status"). The calendar skeleton has the shown month's number of
// weeks and the real page layout (side panel on wide screens). Shapes use
// the line token, not sunken: sunken on the white card was barely visible.
//---------------

const SHAPE = 'animate-pulse bg-line';

// Calendar + day panel side by side on wide screens (so the selected day's
// posts show without scrolling); shared by the page and its skeleton.
export const CALENDAR_LAYOUT_CLASS =
  'xl:grid xl:grid-cols-[minmax(0,1fr)_21rem] xl:items-start xl:gap-6';

function LoadingLabel() {
  const { t } = useI18n();
  return <p className="mb-3 text-sm font-medium text-muted-foreground">{t('posts.loadingPosts')}</p>;
}

export function CalendarLoadingSkeleton({ weeks }: { weeks: number }) {
  return (
    <div role="status">
      <LoadingLabel />
      <div className={CALENDAR_LAYOUT_CLASS}>
        <div aria-hidden data-skeleton-calendar className="min-w-0 rounded-xl border border-line bg-card p-2 sm:p-4">
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
              <div
                key={`day-${i}`}
                data-skeleton-day
                className={`flex h-20 flex-col items-center justify-start gap-1 rounded-md pt-1 opacity-60 sm:h-24 ${SHAPE}`}
              >
                <div className={`size-5 rounded-full bg-line/80`} data-skeleton-day-number />
              </div>
            ))}
          </div>
        </div>
        <div aria-hidden data-skeleton-panel className="mt-6 min-w-0 xl:mt-0 xl:min-h-[22rem]">
          <div className={`h-5 w-64 max-w-full rounded ${SHAPE}`} />
          <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            {Array.from({ length: 2 }, (_, i) => (
              <div key={`card-${i}`} className={`h-36 rounded-xl opacity-60 ${SHAPE}`} />
            ))}
          </div>
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
