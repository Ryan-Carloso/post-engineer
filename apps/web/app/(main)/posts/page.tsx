'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';
import type { ScheduledSlot } from '@/lib/api';
import { RANGE_MAX_SLOTS, useHasAnyPostQuery, useScheduleRangeQuery } from '@/lib/schedule-range';
import { cn } from '@/lib/utils';
import { PostsCalendar } from './calendar-provider';
import { slotToCalendarEvent } from './calendar-adapter';
import { CalendarUnavailableFrame, CalendarLoadErrorEmptyState } from './calendar-load-error-frame';
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
  unionRange,
  weekRange,
  weekStart,
} from './calendar-days';
import { AccountEmptyState, DayEmptyState, DayListRow, NewPostButton } from './day-section';
import { CALENDAR_LAYOUT_CLASS, CalendarLoadingSkeleton } from './loading-skeleton';
import { PostFiltersBar, SlotCard, usePostFilters, usePostJoins } from './post-joins';
import { usePersonaFilter } from './persona-filter';
import { PostsSidebar } from './posts-sidebar';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { OnboardingWizard, OnboardingWizardButton } from './onboarding-wizard';

const MOBILE_QUERY = '(max-width: 767px)';

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return isMobile;
}

export default function PostsPage() {
  const { t, locale } = useI18n();
  const todayKey = dayKey(new Date());
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [pickedKey, setPickedKey] = useState<string | null>(todayKey);
  const isMobile = useIsMobile();
  const [viewOverride, setViewOverride] = useState<'month' | 'week' | null>(null);
  const view = isMobile ? 'week' : (viewOverride ?? 'month');
  const [weekDate, setWeekDate] = useState(() => new Date());
  const mobileWeek = isMobile && view === 'week';
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const daySectionRef = useRef<HTMLElement>(null);
  const joins = usePostJoins();
  const filters = usePostFilters(joins);
  const personaFilter = usePersonaFilter(joins, t('posts.noPersona'), t('posts.personaFallback'));

  const firstWeekday = FIRST_WEEKDAY[locale];
  const gridDays = useMemo(() => buildMonthGrid(cursor.year, cursor.month, firstWeekday), [cursor, firstWeekday]);
  const monthRange = useMemo(() => gridRange(gridDays), [gridDays]);
  const range = useMemo(
    () => (view === 'week' ? unionRange(monthRange, weekRange(weekDate, firstWeekday)) : monthRange),
    [view, monthRange, weekDate, firstWeekday],
  );
  const rangeQuery = useScheduleRangeQuery(monthKey(cursor.year, cursor.month), range.from, range.to, true);
  const { passes: networkPasses } = filters;
  const { passes: personaPasses } = personaFilter;
  const passes = useCallback(
    (slot: ScheduledSlot) => networkPasses(slot) && personaPasses(slot),
    [networkPasses, personaPasses],
  );
  const slotsByDay = useMemo(
    () => bucketByDay((rangeQuery.data?.slots ?? []).filter(passes)),
    [rangeQuery.data, passes],
  );
  const monthPostCount = countMonthPosts(slotsByDay, cursor.year, cursor.month);
  const monthIsEmpty = view === 'month' && monthPostCount === 0;
  const selectedKey = monthIsEmpty
    ? null
    : (pickedKey ?? defaultDayForMonth(cursor.year, cursor.month, todayKey, slotsByDay.keys()));
  const selectedSlots = useMemo(
    () => (selectedKey === null ? [] : [...(slotsByDay.get(selectedKey) ?? [])].sort((a, b) => a.slotAt.localeCompare(b.slotAt))),
    [slotsByDay, selectedKey],
  );

  const showsTodayMonth = todayKey.startsWith(`${monthKey(cursor.year, cursor.month)}-`);
  const joinsReady = !joins.isLoading && !joins.isError;
  const askHasAnyPost =
    joinsReady && joins.scheduleById.size > 0 && showsTodayMonth && rangeQuery.data !== undefined && rangeQuery.data.slots.length === 0;
  const hasAnyPostQuery = useHasAnyPostQuery(askHasAnyPost);
  const neverPosted = askHasAnyPost && hasAnyPostQuery.data === false;

  const isLoading = rangeQuery.isLoading || joins.isLoading || (askHasAnyPost && hasAnyPostQuery.isLoading);
  const isError = rangeQuery.isError || joins.isError;
  const isAccountEmpty = !isLoading && !isError && (joins.scheduleById.size === 0 || neverPosted);
  const loadErrorKey: TranslationKey = rangeQuery.isError ? 'posts.loadErrorCalendar' : 'posts.loadErrorSupporting';
  const handleSelect = useCallback(
    (key: string) => {
      setPickedKey(key);
      if (mobileWeek) {
        setMobilePanelOpen((wasOpen) => (selectedKey === key ? !wasOpen : true));
      }
      const date = dateFromKey(key);
      if (view === 'month') {
        setCursor({ year: date.getFullYear(), month: date.getMonth() });
      } else if (dayKey(weekStart(date, firstWeekday)) !== dayKey(weekStart(weekDate, firstWeekday))) {
        setWeekDate(date);
        setCursor({ year: date.getFullYear(), month: date.getMonth() });
      }
      if (typeof window.matchMedia !== 'function' || !window.matchMedia(MOBILE_QUERY).matches) return;
      requestAnimationFrame(() => {
        const section = daySectionRef.current;
        if (section !== null) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
    [view, firstWeekday, weekDate, mobileWeek, selectedKey],
  );
  const handleMonthNavigate = useCallback((year: number, month: number) => {
    setCursor({ year, month });
    setPickedKey(null);
  }, []);
  const handleWeekNavigate = useCallback((date: Date) => {
    setWeekDate(date);
    setCursor({ year: date.getFullYear(), month: date.getMonth() });
    setPickedKey(null);
  }, []);
  const handleViewChange = useCallback(
    (nextView: 'month' | 'week') => {
      if (nextView === 'week') {
        const anchor = selectedKey === null ? new Date() : dateFromKey(selectedKey);
        setWeekDate(anchor);
        setCursor({ year: anchor.getFullYear(), month: anchor.getMonth() });
        setViewOverride('week');
      } else {
        setCursor({ year: weekDate.getFullYear(), month: weekDate.getMonth() });
        setPickedKey(null);
        setViewOverride('month');
      }
    },
    [selectedKey, weekDate],
  );
  const handleGoToToday = useCallback(() => {
    if (view === 'week') {
      const now = new Date();
      setWeekDate(now);
      setCursor({ year: now.getFullYear(), month: now.getMonth() });
    }
    handleSelect(todayKey);
    if (mobileWeek) setMobilePanelOpen(true);
  }, [handleSelect, todayKey, view, mobileWeek]);
  const handleCalendarDateChange = useCallback(
    (date: Date) => {
      if (view === 'week') {
        if (dayKey(weekStart(date, firstWeekday)) !== dayKey(weekStart(weekDate, firstWeekday))) {
          setWeekDate(weekStart(date, firstWeekday));
          setCursor({ year: date.getFullYear(), month: date.getMonth() });
          setPickedKey(null);
        }
        return;
      }
      if (date.getFullYear() === cursor.year && date.getMonth() === cursor.month) return;
      setCursor({ year: date.getFullYear(), month: date.getMonth() });
      setPickedKey(null);
    },
    [cursor, firstWeekday, view, weekDate],
  );
  const calendarEvents = useMemo(
    () =>
      [...slotsByDay.values()].flatMap((slots) => slots.map((slot) => slotToCalendarEvent(slot, t('posts.unknownTitle')))),
    [slotsByDay, t],
  );
  const handleRefresh = () => {
    void rangeQuery.refetch();
    joins.refetch();
    if (askHasAnyPost) void hasAnyPostQuery.refetch();
  };
  const dayFormat = new Intl.DateTimeFormat(INTL_TAG[locale], { weekday: 'short', day: 'numeric', month: 'short' });
  const monthLabel = new Intl.DateTimeFormat(INTL_TAG[locale], { month: 'long', year: 'numeric' }).format(
    new Date(cursor.year, cursor.month, 1),
  );
  const hasActiveFilter = filters.hasActiveFilter || personaFilter.hasActiveFilter;
  const handleClearFilters = useCallback(() => {
    filters.clear();
    personaFilter.clear();
  }, [filters, personaFilter]);
  const emptyReason = hasActiveFilter ? 'filter' : !monthIsEmpty ? 'day' : 'month';
  const mobileDayFormat = new Intl.DateTimeFormat(INTL_TAG[locale], { weekday: 'long', day: 'numeric', month: 'short' });
  const mobileDayDate = selectedKey === null ? monthLabel : mobileDayFormat.format(dateFromKey(selectedKey));
  const mobileDayHeading = mobileDayDate.charAt(0).toUpperCase() + mobileDayDate.slice(1);
  const mobileDayCount =
    selectedSlots.length === 1
      ? t('posts.calendarDayPostCountOne')
      : t('posts.calendarDayPostCountMany', { count: selectedSlots.length });
  const showDaySection = !mobileWeek || mobilePanelOpen || isAccountEmpty;
  const monthWeeks = gridDays.filter((week) => week.some((day) => day.inMonth)).length;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t('posts.title')}
        description={t(isError ? 'posts.subtitleLoadError' : 'posts.subtitle')}
        actions={
          <>
            <NewPostButton testId="new-post-button" />
            {!isError && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={rangeQuery.isFetching}
                aria-label={t('posts.refresh')}
              >
                <RefreshCw className={cn('size-4', rangeQuery.isFetching && 'animate-spin')} aria-hidden />
                {t('posts.refresh')}
              </Button>
            )}
            <OnboardingWizardButton testId="onboarding-reopen-button" />
          </>
        }
      />
      <PostFiltersBar
        filters={{ ...filters, clear: handleClearFilters, hasActiveFilter }}
        disabled={isLoading || isAccountEmpty || isError}
        unavailable={isError}
      />

      <div className="mt-4 flex items-start gap-6 sm:mt-6">
        <PostsSidebar
          calendars={personaFilter.calendars}
          hiddenIds={personaFilter.hiddenIds}
          onTogglePersona={personaFilter.togglePersona}
          currentDate={new Date(cursor.year, cursor.month, 1)}
          weekStartsOn={firstWeekday}
          locale={locale}
          onSelectDay={handleSelect}
        />
        <div className="min-w-0 flex-1">
          {isLoading ? (
            <CalendarLoadingSkeleton weeks={monthWeeks} />
          ) : (
            <div className={cn('flex flex-col', CALENDAR_LAYOUT_CLASS)}>
              <div
                className={cn(
                  'min-w-0 xl:col-start-1 xl:row-start-1',
                  isError && loadErrorKey === 'posts.loadErrorCalendar' && 'xl:col-span-2',
                )}
              >
                {rangeQuery.data?.truncated === true && (
                  <p className="mb-3 text-xs text-muted-foreground">{t('posts.calendarTruncated', { count: RANGE_MAX_SLOTS })}</p>
                )}
                {isError ? (
                  <div data-calendar-card className="relative max-w-full min-w-0 rounded-xl border border-line bg-card p-2 sm:p-3">
                    <CalendarUnavailableFrame>
                      <CalendarLoadErrorEmptyState messageKey={loadErrorKey} onRetry={handleRefresh} />
                    </CalendarUnavailableFrame>
                  </div>
                ) : (
                  <PostsCalendar
                    events={calendarEvents}
                    date={view === 'week' ? weekStart(weekDate, firstWeekday) : new Date(cursor.year, cursor.month, 1)}
                    view={view}
                    mobileWeek={mobileWeek}
                    showViewSwitcher={!isMobile}
                    weekStartsOn={firstWeekday}
                    locale={locale}
                    loading={rangeQuery.isFetching}
                    muted={isAccountEmpty}
                    todayPressed={!isAccountEmpty && selectedKey === todayKey}
                    onDateChange={handleCalendarDateChange}
                    onSelectDay={handleSelect}
                    onMonthNavigate={handleMonthNavigate}
                    onWeekNavigate={handleWeekNavigate}
                    onViewChange={handleViewChange}
                    onGoToToday={handleGoToToday}
                  />
                )}
              </div>
              {isError && loadErrorKey !== 'posts.loadErrorCalendar' ? (
                <section
                  data-day-unavailable-note
                  aria-live="polite"
                  className="order-2 mt-4 hidden min-w-0 scroll-mt-4 rounded-xl border border-destructive/30 bg-destructive-soft/70 px-3 py-2.5 text-sm text-ink xl:col-start-2 xl:row-start-1 xl:mt-0 xl:block xl:max-w-md xl:self-start"
                >
                  <p className="flex items-start gap-2 font-medium">
                    <TriangleAlert data-load-side-warning className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                    <span>{t('posts.loadErrorSideQuiet')}</span>
                  </p>
                </section>
              ) : !isError && showDaySection ? (
                <section
                  ref={daySectionRef}
                  aria-live="polite"
                  className="order-2 mt-4 min-w-0 scroll-mt-4 max-xl:pb-24 xl:col-start-2 xl:row-start-1 xl:mt-0 xl:pt-4"
                >
                  {isAccountEmpty ? (
                    <>
                      <h2 className="text-base font-bold tracking-[-0.01em] text-primary">
                        {t('posts.calendarMonthHeading', { month: monthLabel })}
                      </h2>
                      <div className="mt-3">
                        <AccountEmptyState />
                      </div>
                    </>
                  ) : mobileWeek ? (
                    <>
                      <h2 className="flex min-h-10 items-center gap-2 text-base font-bold tracking-[-0.01em] text-primary">
                        <span className="truncate">{mobileDayHeading}</span>
                        {selectedSlots.length > 0 && (
                          <span className="shrink-0 text-sm font-semibold text-muted-foreground"> · {mobileDayCount}</span>
                        )}
                      </h2>
                      <div className="mt-3">
                        {selectedSlots.length === 0 ? (
                          <DayEmptyState
                            reason={emptyReason}
                            monthLabel={monthLabel}
                            onClearFilters={handleClearFilters}
                          />
                        ) : (
                          <div className="divide-y divide-line rounded-xl border border-line bg-card px-3">
                            {selectedSlots.map((slot) => (
                              <DayListRow key={slot.id} slot={slot} joins={joins} />
                            ))}
                          </div>
                        )}
                      </div>
                      <p className="mt-3 text-center text-xs text-muted-foreground">{t('posts.dayPanelSwitchHint')}</p>
                    </>
                  ) : (
                    <>
                      <h2 className="flex min-h-10 flex-col justify-center gap-0.5 text-base font-bold tracking-[-0.01em] text-primary">
                        {monthIsEmpty || selectedKey === null ? (
                          t('posts.calendarMonthHeading', { month: monthLabel })
                        ) : (
                          <>
                            <span>{t('posts.calendarDayHeading', { date: dayFormat.format(dateFromKey(selectedKey)) })}</span>
                            {selectedSlots.length > 0 && (
                              <span className="text-sm font-semibold text-muted-foreground">
                                {selectedSlots.length === 1
                                  ? t('posts.calendarDayPostCountOne')
                                  : t('posts.calendarDayPostCountMany', { count: selectedSlots.length })}
                              </span>
                            )}
                          </>
                        )}
                      </h2>
                      <div className="mt-3">
                        {selectedSlots.length === 0 ? (
                          <DayEmptyState
                            reason={emptyReason}
                            monthLabel={monthLabel}
                            onClearFilters={handleClearFilters}
                          />
                        ) : (
                          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                            {selectedSlots.map((slot) => (
                              <SlotCard key={slot.id} slot={slot} joins={joins} timeOnly />
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </section>
              ) : null}
            </div>
          )}
        </div>
      </div>
      <OnboardingWizard />
    </div>
  );
}
