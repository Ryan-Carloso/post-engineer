'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';
import { RANGE_MAX_SLOTS, useScheduleRangeQuery } from '@/lib/schedule-range';
import { cn } from '@/lib/utils';
import { CalendarView } from './calendar-view';
import {
  FIRST_WEEKDAY,
  INTL_TAG,
  bucketByDay,
  buildMonthGrid,
  countMonthPosts,
  dateFromKey,
  dayKey,
  defaultDayForMonth,
  gridRange,
  monthKey,
} from './calendar-days';
import { AccountEmptyState, DayEmptyState, DaySummary, LoadErrorBanner } from './day-section';
import { CalendarLoadingSkeleton } from './loading-skeleton';
import { PostFiltersBar, SlotCard, usePostFilters, usePostJoins } from './post-joins';

//---------------
// PostsPage — month calendar of every post (past and upcoming) across all
// connected accounts. Read-only: the visible 6-week grid is one from/to
// range read of GET /api/schedule/status. Selecting a day lists its posts
// below the calendar; today is selected on open. Past posts and video
// generations as a list live on /posts/history.
//---------------

// Below Tailwind's `sm` breakpoint the day list starts under the fold, so
// picking a day scrolls it into view there.
const NARROW_SCREEN_QUERY = '(max-width: 639px)';

export default function PostsPage() {
  const { t, locale } = useI18n();
  // "Today" is the viewer's local day (see calendar-days.ts), computed on
  // every render so a page left open past midnight marks the new day.
  const todayKey = dayKey(new Date());
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  // null = the month's default day (defaultDayForMonth), resolved against
  // the loaded posts on every render: month navigation sets it, so the
  // pick follows the month's data instead of a stale day number.
  const [pickedKey, setPickedKey] = useState<string | null>(todayKey);
  const daySectionRef = useRef<HTMLElement>(null);
  const joins = usePostJoins();
  const filters = usePostFilters(joins);

  const firstWeekday = FIRST_WEEKDAY[locale];
  const gridDays = useMemo(() => buildMonthGrid(cursor.year, cursor.month, firstWeekday), [cursor, firstWeekday]);
  const range = useMemo(() => gridRange(gridDays), [gridDays]);
  const rangeQuery = useScheduleRangeQuery(monthKey(cursor.year, cursor.month), range.from, range.to, true);
  const slotsByDay = useMemo(
    () => bucketByDay((rangeQuery.data?.slots ?? []).filter(filters.passes)),
    [rangeQuery.data, filters.passes],
  );
  const selectedKey = pickedKey ?? defaultDayForMonth(cursor.year, cursor.month, todayKey, slotsByDay.keys());
  const selectedSlots = useMemo(
    () => [...(slotsByDay.get(selectedKey) ?? [])].sort((a, b) => a.slotAt.localeCompare(b.slotAt)),
    [slotsByDay, selectedKey],
  );

  const isLoading = rangeQuery.isLoading || joins.isLoading;
  const isError = rangeQuery.isError || joins.isError;
  // Every post belongs to a schedule (slots of a deleted one never pass the
  // filters), so an account without schedules has no post in any month.
  const isAccountEmpty = !isLoading && !isError && joins.scheduleById.size === 0;
  // The error names what failed: the month's posts, or the supporting
  // data (schedules, personas, accounts) behind the cards and filters.
  // No internal detail is exposed — only which part of the page is down.
  const loadErrorKey: TranslationKey = rangeQuery.isError ? 'posts.loadErrorCalendar' : 'posts.loadErrorSupporting';
  // Month and selected day stay in sync both ways: picking a day (including
  // an outside day from the neighbouring month) shows that day's month,
  // and the month buttons move the selection to the new month's default
  // day instead of leaving the detail below on a day from the month left.
  const handleSelect = useCallback((key: string) => {
    setPickedKey(key);
    const date = dateFromKey(key);
    setCursor({ year: date.getFullYear(), month: date.getMonth() });
    const section = daySectionRef.current;
    if (section === null || typeof window.matchMedia !== 'function' || !window.matchMedia(NARROW_SCREEN_QUERY).matches) return;
    if (section.getBoundingClientRect().top > window.innerHeight - 120) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);
  const handleMonthNavigate = useCallback((year: number, month: number) => {
    setCursor({ year, month });
    setPickedKey(null);
  }, []);
  // The error state covers every query, so retry refetches all of them.
  const handleRetry = () => {
    void rangeQuery.refetch();
    joins.refetch();
  };
  const dayFormat = new Intl.DateTimeFormat(INTL_TAG[locale], { weekday: 'long', day: 'numeric', month: 'long' });
  const monthLabel = new Intl.DateTimeFormat(INTL_TAG[locale], { month: 'long', year: 'numeric' }).format(
    new Date(cursor.year, cursor.month, 1),
  );
  const monthPostCount = countMonthPosts(slotsByDay, cursor.year, cursor.month);
  const emptyReason = monthPostCount > 0 ? 'day' : filters.hasActiveFilter ? 'filter' : 'month';

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-primary">{t('posts.title')}</h1>
        {!isError && (
          <button
            type="button"
            onClick={handleRetry}
            disabled={rangeQuery.isFetching}
            aria-label={t('posts.refresh')}
            className="inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-xl border border-input bg-card px-2.5 text-sm font-semibold text-primary hover:bg-sunken disabled:opacity-50 sm:px-4"
          >
            <RefreshCw className={cn('size-4', rangeQuery.isFetching && 'animate-spin')} aria-hidden />
            <span className="hidden sm:inline">{t('posts.refresh')}</span>
          </button>
        )}
      </div>
      {/* The hint is for wide screens; on a phone the calendar comes first. */}
      <p className="mt-1 hidden text-sm text-muted-foreground sm:block">{t('posts.subtitle')}</p>

      {!isAccountEmpty && <PostFiltersBar filters={filters} />}

      <div className="mt-4 sm:mt-6">
        {isLoading ? (
          <CalendarLoadingSkeleton />
        ) : isAccountEmpty ? (
          <AccountEmptyState />
        ) : (
          <>
            {isError && <LoadErrorBanner messageKey={loadErrorKey} onRetry={handleRetry} retrying={rangeQuery.isFetching} />}
            {rangeQuery.data?.truncated === true && (
              <p className="mb-3 text-xs text-muted-foreground">{t('posts.calendarTruncated', { count: RANGE_MAX_SLOTS })}</p>
            )}
            {/* On error the calendar stays, so the month can still change. */}
            <CalendarView
              year={cursor.year}
              month={cursor.month}
              firstWeekday={firstWeekday}
              slotsByDay={slotsByDay}
              scheduleById={joins.scheduleById}
              personaPhotoById={joins.personaPhotoById}
              selectedKey={selectedKey}
              todayKey={todayKey}
              onSelect={handleSelect}
              onMonthChange={(year, month) => setCursor({ year, month })}
              onMonthNavigate={handleMonthNavigate}
            />
            {!isError && (
              <section ref={daySectionRef} aria-live="polite" className="mt-6 scroll-mt-4">
                <h2 className="text-base font-bold tracking-[-0.01em] text-primary">
                  {t('posts.calendarDayHeading', { date: dayFormat.format(dateFromKey(selectedKey)) })}
                </h2>
                <DaySummary slots={selectedSlots} />
                <div className="mt-3">
                  {selectedSlots.length === 0 ? (
                    <DayEmptyState reason={emptyReason} monthLabel={monthLabel} />
                  ) : (
                    <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {selectedSlots.map((slot) => (
                        <SlotCard key={slot.id} slot={slot} joins={joins} timeOnly />
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
