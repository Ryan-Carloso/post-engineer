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

//---------------
// PostsPage — calendar of every post (past and upcoming) across all
// connected accounts: the month grid on wide screens, the week view below
// the `md` breakpoint (one time axis, dots instead of chips, day panel
// below the grid and only after a tap). Read-only: the visible days are
// one from/to range read of GET /api/schedule/status (the union of the
// month grid and the shown week). Selecting a day lists its posts beside
// the calendar on wide screens (so they show without scrolling) and below
// it on a phone, once tapped; today is selected on open but its panel
// stays hidden until tapped. Past posts and video generations as a list
// live on /posts/history.
//---------------

// Below Tailwind's `md` breakpoint the calendar is the week view only:
// seven columns fit a phone, a month grid does not.
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
  const isMobile = useIsMobile();
  // Desktop-only override from the view switcher; mobile is always week.
  const [viewOverride, setViewOverride] = useState<'month' | 'week' | null>(null);
  const view = isMobile ? 'week' : (viewOverride ?? 'month');
  // Anchor of the shown week (any day in it); the provider draws from the
  // week start, the page keeps the anchor so switching views keeps context.
  const [weekDate, setWeekDate] = useState(() => new Date());
  // On a phone the day panel sits below the week grid and only opens on a
  // tap (Alternative A): nothing below the grid until the user taps a day,
  // a second tap on the same day collapses it again.
  const mobileWeek = isMobile && view === 'week';
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const daySectionRef = useRef<HTMLElement>(null);
  const joins = usePostJoins();
  const filters = usePostFilters(joins);
  const personaFilter = usePersonaFilter(joins, t('posts.noPersona'), t('posts.personaFallback'));

  const firstWeekday = FIRST_WEEKDAY[locale];
  const gridDays = useMemo(() => buildMonthGrid(cursor.year, cursor.month, firstWeekday), [cursor, firstWeekday]);
  const monthRange = useMemo(() => gridRange(gridDays), [gridDays]);
  // The week can leave the month grid (a week straddling two months): the
  // read covers both, so the week's days never render empty.
  const range = useMemo(
    () => (view === 'week' ? unionRange(monthRange, weekRange(weekDate, firstWeekday)) : monthRange),
    [view, monthRange, weekDate, firstWeekday],
  );
  const rangeQuery = useScheduleRangeQuery(monthKey(cursor.year, cursor.month), range.from, range.to, true);
  // The persona toggles filter on top of the network/account filters: one
  // combined predicate, so the grid, the counts and the day list agree.
  // Destructured first: the filter objects are fresh literals every render,
  // their `passes` callbacks are the stable values the predicate needs.
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
  // A month with no posts is a month-level empty state: no day stays
  // highlighted while the panel talks about the whole month. In week view
  // the panel is day-scoped, so the cursor month's emptiness must not
  // override the picked day (the shown week can sit in another month).
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
  // The calendar opens on today's month: when that whole grid is empty,
  // one small read tells "no posts this month" from "no posts yet" (an
  // account whose schedules never produced a post). If that read fails,
  // the page keeps the month's own empty state — it is never a dead end.
  const askHasAnyPost =
    joinsReady && joins.scheduleById.size > 0 && showsTodayMonth && rangeQuery.data !== undefined && rangeQuery.data.slots.length === 0;
  const hasAnyPostQuery = useHasAnyPostQuery(askHasAnyPost);
  const neverPosted = askHasAnyPost && hasAnyPostQuery.data === false;

  const isLoading = rangeQuery.isLoading || joins.isLoading || (askHasAnyPost && hasAnyPostQuery.isLoading);
  const isError = rangeQuery.isError || joins.isError;
  // Every post belongs to a schedule (slots of a deleted one never pass the
  // filters), so an account without schedules has no post in any month.
  const isAccountEmpty = !isLoading && !isError && (joins.scheduleById.size === 0 || neverPosted);
  // The error names what failed: the month's posts, or the supporting
  // data (schedules, personas, accounts) behind the cards and filters.
  // No internal detail is exposed — only which part of the page is down.
  const loadErrorKey: TranslationKey = rangeQuery.isError ? 'posts.loadErrorCalendar' : 'posts.loadErrorSupporting';
  // Month and selected day stay in sync both ways: picking a day (including
  // an outside day from the neighbouring month) shows that day's month,
  // and the month buttons move the selection to the new month's default
  // day instead of leaving the detail below on a day from the month left.
  // In week view a pick inside the shown week only moves the panel, but a
  // pick from outside it — the sidebar mini calendar can name any day —
  // moves the anchor (and the month cursor with it), so the read covers the
  // picked day and the panel never names a day outside the read.
  // On a narrow screen the pick scrolls the day panel into view: the panel
  // sits below the grid, so the scroll brings it up from under the fold.
  const handleSelect = useCallback(
    (key: string) => {
      setPickedKey(key);
      // On a phone the panel opens on a tap and collapses on a second tap
      // of the same day; another day switches it. The open day is the
      // selected day, so a week move follows the new default day instead
      // of naming a day outside the read.
      if (mobileWeek) {
        setMobilePanelOpen((wasOpen) => (selectedKey === key ? !wasOpen : true));
      }
      const date = dateFromKey(key);
      if (view === 'month') {
        setCursor({ year: date.getFullYear(), month: date.getMonth() });
      } else if (dayKey(weekStart(date, firstWeekday)) !== dayKey(weekStart(weekDate, firstWeekday))) {
        // The pick left the shown week (mini calendar, back-to-today): the
        // anchor follows it, so the read covers the picked day and the
        // panel never names a day outside the read.
        setWeekDate(date);
        setCursor({ year: date.getFullYear(), month: date.getMonth() });
      }
      // The section mounts on the tap that opens it, so its ref is only
      // set after this commit: read it inside the frame, not here.
      // Same breakpoint as mobileWeek: throughout the mobile week range
      // the panel is below the 600px grid and hidden until this tap, so
      // it needs bringing into view — at 640-767px it would open
      // off-screen and the tap would look like it did nothing.
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
    // The month cursor follows the shown week: the read is the union of the
    // month grid and the week, and the API rejects spans over 62 days.
    setCursor({ year: date.getFullYear(), month: date.getMonth() });
    // The pick follows the shown week, like the month buttons do: a day
    // left behind is outside the read, so its panel would be a false empty.
    setPickedKey(null);
  }, []);
  // Switching views keeps context: the week opens on the selected day, the
  // month on the shown week's month.
  const handleViewChange = useCallback(
    (nextView: 'month' | 'week') => {
      if (nextView === 'week') {
        const anchor = selectedKey === null ? new Date() : dateFromKey(selectedKey);
        setWeekDate(anchor);
        // The month cursor follows the shown week: otherwise the union read
        // spans from the old month grid to the new week and the API rejects it.
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
    // "Hoje" always opens today's panel on a phone, never toggles it shut.
    if (mobileWeek) setMobilePanelOpen(true);
  }, [handleSelect, todayKey, view, mobileWeek]);
  // The grid's date hints (a day click, grid scroll): a hint inside the
  // shown month is just the page's own cursor; one outside it moves the
  // month and clears the pick, like the toolbar buttons above. In week
  // view the same rule holds per week: the lib navigates weeks on its own
  // (grid scroll, keyboard), and a hint in another week moves the anchor.
  const handleCalendarDateChange = useCallback(
    (date: Date) => {
      if (view === 'week') {
        if (dayKey(weekStart(date, firstWeekday)) !== dayKey(weekStart(weekDate, firstWeekday))) {
          setWeekDate(weekStart(date, firstWeekday));
          // The month cursor follows the shown week, as in handleWeekNavigate.
          setCursor({ year: date.getFullYear(), month: date.getMonth() });
          // The pick follows the shown week, as in handleWeekNavigate.
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
  // The one Refresh control covers every query, so it refetches all of them.
  const handleRefresh = () => {
    void rangeQuery.refetch();
    joins.refetch();
    if (askHasAnyPost) void hasAnyPostQuery.refetch();
  };
  // Short date so "Posts on Mon, Nov 9" / "Posts de seg., 9 de nov." stays
  // on one line in the side panel.
  const dayFormat = new Intl.DateTimeFormat(INTL_TAG[locale], { weekday: 'short', day: 'numeric', month: 'short' });
  const monthLabel = new Intl.DateTimeFormat(INTL_TAG[locale], { month: 'long', year: 'numeric' }).format(
    new Date(cursor.year, cursor.month, 1),
  );
  // The panel is scoped like its content: a month without posts is named
  // as a month, a day of a month with posts as that day. A filter that
  // empties the selected day is a filter empty state even when the month
  // still has posts — the clear-filters action is the way out.
  // A hidden persona empties the day the same way a network filter does,
  // and the clear-filters action clears both.
  const hasActiveFilter = filters.hasActiveFilter || personaFilter.hasActiveFilter;
  const handleClearFilters = useCallback(() => {
    filters.clear();
    personaFilter.clear();
  }, [filters, personaFilter]);
  const emptyReason = hasActiveFilter ? 'filter' : !monthIsEmpty ? 'day' : 'month';
  // Mobile week panel heading: "Saturday, Jun 1 · 1 post" — long weekday,
  // day and short month on one line with the count, like the mockup.
  const mobileDayFormat = new Intl.DateTimeFormat(INTL_TAG[locale], { weekday: 'long', day: 'numeric', month: 'short' });
  const mobileDayDate = selectedKey === null ? monthLabel : mobileDayFormat.format(dateFromKey(selectedKey));
  const mobileDayHeading = mobileDayDate.charAt(0).toUpperCase() + mobileDayDate.slice(1);
  const mobileDayCount =
    selectedSlots.length === 1
      ? t('posts.calendarDayPostCountOne')
      : t('posts.calendarDayPostCountMany', { count: selectedSlots.length });
  // The panel is hidden on a phone until a day is tapped; everywhere else
  // it always shows. Account empty is not a tappable day — the calendar is
  // muted and the sidebar mini calendar is desktop-only, so no tap could
  // ever open it: its panel shows on a phone too.
  const showDaySection = !mobileWeek || mobilePanelOpen || isAccountEmpty;
  // Only the weeks the month spans, like the calendar itself.
  const monthWeeks = gridDays.filter((week) => week.some((day) => day.inMonth)).length;

  return (
    <div className="mx-auto max-w-6xl">
      {/* On a load error the header refresh hides; retry lives in the calendar card. */}
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
                {/* On error the calendar card becomes a recovery frame: alert + in-card retry, no grid.
                  The frame keeps the card chrome (same classes as PostsCalendar) so the
                  recovery state reads as the calendar, not a bare page error. */}
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
                          // One bordered card, one summarized line per video:
                          // a full day fits without scroll, no big cards.
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
                        // One column in the side panel; two in between; one on a
                        // phone. Rows, not cards: a full day fits without scroll.
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
