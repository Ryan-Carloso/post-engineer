'use client';

import { useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import { SpinnerIcon } from '@/lib/ui';
import { RANGE_MAX_SLOTS, useScheduleRangeQuery } from '@/lib/schedule-range';
import { CalendarView } from './calendar-view';
import { GROUP_KEY, GROUP_STYLE, STATUS_GROUP_ORDER } from './status';
import { FIRST_WEEKDAY, INTL_TAG, bucketByDay, buildMonthGrid, dateFromKey, dayKey, groupCounts, gridRange, monthKey } from './calendar-days';
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
  // The error state covers every query, so retry refetches all of them.
  const handleRetry = () => {
    void rangeQuery.refetch();
    joins.refetch();
  };
  const dayFormat = new Intl.DateTimeFormat(INTL_TAG[locale], { dateStyle: 'full' });
  const counts = groupCounts(selectedSlots);

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
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <SpinnerIcon /> {t('posts.refresh')}…
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-input bg-card p-8 text-center">
            <p className="text-sm font-semibold text-primary">{t('posts.loadError')}</p>
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
              selectedKey={selectedKey}
              todayKey={todayKey}
              onSelect={setSelectedKey}
              onMonthChange={(year, month) => setCursor({ year, month })}
            />
            <section aria-live="polite" className="mt-6">
              <h2 className="text-base font-bold tracking-[-0.01em] text-primary">
                {t('posts.calendarDayHeading', { date: dayFormat.format(dateFromKey(selectedKey)) })}
              </h2>
              <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                {STATUS_GROUP_ORDER.map((group) => (
                  <li key={group} className={`rounded-full px-2 py-0.5 font-semibold ${GROUP_STYLE[group]}`}>
                    {t(GROUP_KEY[group])}: {counts[group]}
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
