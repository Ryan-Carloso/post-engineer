'use client';

import { useCallback, useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';
import { RANGE_MAX_SLOTS, useScheduleRangeQuery } from '@/lib/schedule-range';
import { CalendarView } from './calendar-view';
import { CALENDAR_GROUP_KEY, CALENDAR_GROUP_ORDER, CALENDAR_GROUP_STYLE } from './status';
import { FIRST_WEEKDAY, INTL_TAG, bucketByDay, buildMonthGrid, calendarCounts, dateFromKey, dayKey, gridRange, monthKey, sameDayInMonth } from './calendar-days';
import { CalendarLoadingSkeleton } from './loading-skeleton';
import { PostFiltersBar, SlotCard, usePostFilters, usePostJoins } from './post-joins';

//---------------
// PostsPage — month calendar of every post (past and upcoming) across all
// connected accounts. Read-only: the visible 6-week grid is one from/to
// range read of GET /api/schedule/status. Clicking a day lists its posts
// below the calendar; today is selected on open. Past posts and video
// generations as a list live on /posts/history.
//---------------

export default function PostsPage() {
  const { t, locale } = useI18n();
  // "Today" is the viewer's local day (see calendar-days.ts), computed on
  // every render so a page left open past midnight marks the new day.
  const todayKey = dayKey(new Date());
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedKey, setSelectedKey] = useState(todayKey);
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
  const selectedSlots = useMemo(
    () => [...(slotsByDay.get(selectedKey) ?? [])].sort((a, b) => a.slotAt.localeCompare(b.slotAt)),
    [slotsByDay, selectedKey],
  );

  const isLoading = rangeQuery.isLoading || joins.isLoading;
  const isError = rangeQuery.isError || joins.isError;
  // The error names what failed: the month's posts, or the supporting
  // data (schedules, personas, accounts) behind the cards and filters.
  // No internal detail is exposed — only which part of the page is down.
  const loadErrorKey: TranslationKey = rangeQuery.isError ? 'posts.loadErrorCalendar' : 'posts.loadErrorSupporting';
  // Month and selected day stay in sync both ways: picking a day (including
  // an outside day from the neighbouring month) shows that day's month,
  // and the month buttons move the selection into the new month instead
  // of leaving the detail below on a day from the month just left.
  const handleSelect = useCallback((key: string) => {
    setSelectedKey(key);
    const date = dateFromKey(key);
    setCursor({ year: date.getFullYear(), month: date.getMonth() });
  }, []);
  const handleMonthNavigate = useCallback((year: number, month: number) => {
    setCursor({ year, month });
    setSelectedKey((current) => sameDayInMonth(current, year, month));
  }, []);
  // The error state covers every query, so retry refetches all of them.
  const handleRetry = () => {
    void rangeQuery.refetch();
    joins.refetch();
  };
  const dayFormat = new Intl.DateTimeFormat(INTL_TAG[locale], { dateStyle: 'full' });
  const counts = calendarCounts(selectedSlots);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-primary">{t('posts.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('posts.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={handleRetry}
          disabled={rangeQuery.isFetching}
          className="rounded-xl border border-input bg-card px-4 py-2 text-sm font-semibold text-primary hover:bg-background disabled:opacity-50"
        >
          {t('posts.refresh')}
        </button>
      </div>

      <PostFiltersBar filters={filters} />

      <div className="mt-6">
        {isLoading ? (
          <CalendarLoadingSkeleton />
        ) : isError ? (
          <div className="rounded-xl border border-input bg-card p-8 text-center">
            <p className="text-sm font-semibold text-primary">{t(loadErrorKey)}</p>
            <button
              type="button"
              onClick={handleRetry}
              className="mt-3 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-ink hover:bg-accent-hover"
            >
              {t('posts.refresh')}
            </button>
          </div>
        ) : (
          <>
            {rangeQuery.data?.truncated === true && (
              <p className="mb-3 text-xs text-muted-foreground">{t('posts.calendarTruncated', { count: RANGE_MAX_SLOTS })}</p>
            )}
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
            <section aria-live="polite" className="mt-6">
              <h2 className="text-base font-bold tracking-[-0.01em] text-primary">
                {t('posts.calendarDayHeading', { date: dayFormat.format(dateFromKey(selectedKey)) })}
              </h2>
              <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                {CALENDAR_GROUP_ORDER.map((group) => (
                  <li key={group} className={`rounded-full px-2 py-0.5 font-semibold ${CALENDAR_GROUP_STYLE[group]}`}>
                    {t(CALENDAR_GROUP_KEY[group])}: {counts[group]}
                  </li>
                ))}
              </ul>
              {selectedSlots.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  {filters.hasActiveFilter ? t('posts.noResultsForFilter') : t('posts.calendarDayNone')}
                </p>
              ) : (
                <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {selectedSlots.map((slot) => (
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
