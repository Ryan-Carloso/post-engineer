'use client';

import { useCallback, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { enUS, ptBR } from 'date-fns/locale';
import { format } from 'date-fns';
import { CalendarProvider } from '@/components/calendar-provider';
import { MonthView } from '@/components/month-view';
import { WeekView } from '@/components/week-view';
import type { DetailedCalendarEvent } from '@/components/calendar-types';
import { useI18n } from '@/lib/i18n/provider';
import type { Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { addDays, dayKey, weekStart } from './calendar-days';
import { readSecondaryTimeZone } from './secondary-timezone';

//---------------
// PostsCalendar — the /posts calendar on CalendarCN's MonthView or WeekView.
//
// Read-only in this slice: events are controlled by the page, a click on a
// chip navigates to the post detail, a click on a day selects it for the
// day panel. The lib has no readOnly switch, so the edit paths are stopped
// here, at the wrapper, instead of inside the lib:
// - drag/resize start on pointerdown over an event: stopped in capture, so
//   no ghost ever follows the pointer and a drop commits nothing;
// - the click that follows a drag is swallowed in capture, so a drag never
//   navigates or selects a day either (a plain click still does);
// - the event context menu and Alt+Arrow keyboard moves are stopped the
//   same way; the details popover is off (showEventPopover={false}).
// Remove these guards when a later slice wires drag to reschedule.
//
// Views: month is the desktop view, week the mobile one (the page forces
// week below the `md` breakpoint). The page owns `date`: the first day of
// the shown month in month view, the first day of the shown week in week
// view — the lib draws its seven columns from that date, and the wrapper
// maps a column click back to a day the same way.
//---------------

// The month's toolbar chevrons: one size, ink chevrons, 40px touch target.
const NAV_ARROW_CLASS =
  'inline-flex size-10 min-h-10 min-w-10 shrink-0 items-center justify-center rounded-md p-0 text-ink transition-colors select-none hover:bg-sunken active:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:opacity-50 [&_svg]:size-6 [&_svg]:stroke-[2.5] [&_svg]:text-ink';

// How far a press may wander before its trailing click counts as a drag.
const DRAG_THRESHOLD_PX = 4;

export type PostsCalendarView = 'month' | 'week';

// The week range as the toolbar shows it: one month when the week stays
// inside it ("2 – 8 Jun"), both months when it straddles them
// ("30 Nov – 6 Dec"). Month abbreviations are capped the same way in both
// locales (date-fns returns "nov" in pt, "Nov" in en).
export function formatWeekRange(start: Date, end: Date, locale: Locale): string {
  const dateFnsLocale = locale === 'pt' ? ptBR : enUS;
  const monthAbbr = (day: Date): string => {
    const abbr = format(day, 'MMM', { locale: dateFnsLocale });
    return abbr.charAt(0).toUpperCase() + abbr.slice(1);
  };
  if (start.getMonth() === end.getMonth()) return `${format(start, 'd')} – ${format(end, 'd')} ${monthAbbr(end)}`;
  return `${format(start, 'd')} ${monthAbbr(start)} – ${format(end, 'd')} ${monthAbbr(end)}`;
}

// Index of the day column under a horizontal point, or -1: the columns line
// up with the day header cells, so a tap on a header or on the all-day row
// names its day by x position. Bounds are left-inclusive, right-exclusive.
export function dayColumnIndexForPoint(
  clientX: number,
  columns: Array<{ left: number; right: number }>,
): number {
  return columns.findIndex(({ left, right }) => clientX >= left && clientX < right);
}

export interface PostsCalendarProps {
  events: DetailedCalendarEvent[];
  /** First day of the shown month (month view) or week (week view), owned by the page. */
  date: Date;
  view: PostsCalendarView;
  /** Desktop only: the page hides the switcher below the `md` breakpoint, where the week is the only view. */
  showViewSwitcher: boolean;
  weekStartsOn: 0 | 1;
  locale: Locale;
  loading: boolean;
  /** Account with no posts: the grid stays readable, not interactive. */
  muted?: boolean;
  /** Today is the selected day: the Today control reads pressed. */
  todayPressed: boolean;
  /** The lib's date hints (day clicks, grid scroll): the page syncs its month. */
  onDateChange: (date: Date) => void;
  /** A day was picked: the page lists its posts. */
  onSelectDay: (key: string) => void;
  onMonthNavigate: (year: number, month: number) => void;
  onWeekNavigate: (date: Date) => void;
  onViewChange: (view: PostsCalendarView) => void;
  onGoToToday: () => void;
}

function shiftMonth(date: Date, delta: number): { year: number; month: number } {
  const shifted = new Date(date.getFullYear(), date.getMonth() + delta, 1);
  return { year: shifted.getFullYear(), month: shifted.getMonth() };
}

export function PostsCalendar({
  events,
  date,
  view,
  showViewSwitcher,
  weekStartsOn,
  locale,
  loading,
  muted = false,
  todayPressed,
  onDateChange,
  onSelectDay,
  onMonthNavigate,
  onWeekNavigate,
  onViewChange,
  onGoToToday,
}: PostsCalendarProps) {
  const { t } = useI18n();
  const router = useRouter();
  // Where the last press started, to tell a drag from a click. The event id
  // is null for a press on empty space: its trailing click is a drag's too.
  const dragStartRef = useRef<{ x: number; y: number; eventId: string | null } | null>(null);
  const weekWrapRef = useRef<HTMLDivElement | null>(null);
  // The secondary zone (Lisbon by default) is read once: the week view's
  // second time axis renders from it, the month view ignores it.
  const [secondaryTimeZone] = useState(readSecondaryTimeZone);
  // The week view draws its columns from the week start, never from a
  // mid-week date: the page passes the start, this normalizes defensively.
  const weekStartDate = view === 'week' ? weekStart(date, weekStartsOn) : date;

  const handleEventSelect = useCallback(
    (eventId: string) => {
      router.push(`/posts/${eventId}`);
    },
    [router],
  );

  const handleGridClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (muted) return;
      const target = event.target as HTMLElement;
      // An event chip owns its click: the provider navigates to its detail.
      if (target.closest('[data-event-id]')) return;
      const key = target.closest<HTMLElement>('[data-date]')?.dataset.date;
      if (key) onSelectDay(key);
    },
    [muted, onSelectDay],
  );

  const handleEventPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const eventId = (event.target as HTMLElement).closest('[data-event-id]')?.getAttribute('data-event-id') ?? null;
    dragStartRef.current = { x: event.clientX, y: event.clientY, eventId };
    if (eventId === null) return;
    // Read-only: the lib's drag/resize start here. Stopping the press keeps
    // the ghost, the drop commit and the drag's trailing selection away.
    event.stopPropagation();
  }, []);

  const handleGridClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const start = dragStartRef.current;
      dragStartRef.current = null;
      if (start !== null) {
        const moved =
          Math.abs(event.clientX - start.x) > DRAG_THRESHOLD_PX || Math.abs(event.clientY - start.y) > DRAG_THRESHOLD_PX;
        if (moved) {
          // A drag's trailing click selects nothing and navigates nowhere.
          event.stopPropagation();
          return;
        }
      }
      if (view !== 'week') return;
      if (muted) return;
      const target = event.target as HTMLElement;
      // An event chip owns its click: the provider navigates to its detail.
      if (target.closest('[data-event-id]')) return;
      const wrapper = weekWrapRef.current;
      if (wrapper === null) return;
      // On-screen day columns only: the grid buffers off-screen days for
      // scrolling, and those are inert.
      const columns = [...wrapper.querySelectorAll('[role="group"][aria-label]:not([inert])')];
      let index = -1;
      const column = target.closest('[role="group"][aria-label]');
      if (column !== null) index = columns.indexOf(column);
      if (index === -1) {
        // A tap on the day header or the all-day row lands outside any
        // column: the columns line up with the header cells, so the x
        // position names the day.
        index = dayColumnIndexForPoint(
          event.clientX,
          columns.map((element) => element.getBoundingClientRect()),
        );
      }
      if (index === -1) return;
      onSelectDay(dayKey(addDays(weekStartDate, index)));
    },
    [muted, onSelectDay, view, weekStartDate],
  );

  const handleEventContextMenuCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    // Read-only: the menu's cut/copy/duplicate/delete have nothing to do.
    if ((event.target as HTMLElement).closest('[data-event-id]')) event.stopPropagation();
  }, []);

  const handleEventKeyDownCapture = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Read-only: Alt+Arrow moves (or with Shift, resizes) the focused event.
    // Enter/Space pass through: they click the chip and navigate.
    if (event.altKey && (event.target as HTMLElement).closest('[data-event-id]')) {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.stopPropagation();
      }
    }
  }, []);

  const prev = shiftMonth(date, -1);
  const next = shiftMonth(date, 1);
  const prevWeek = addDays(date, -7);
  const nextWeek = addDays(date, 7);
  const dateFnsLocale = locale === 'pt' ? ptBR : enUS;
  // The caption is the old grid's: date-fns "LLLL yyyy" ("Novembro 2026",
  // "November 2026") — the panel heading's Intl string ("novembro de
  // 2026") carries a "de" the caption never had. The first letter is
  // capped here, not in CSS: Tailwind emits no `first-letter:uppercase`
  // rule in this build.
  const caption = format(date, 'LLLL yyyy', { locale: dateFnsLocale });
  const captionLabel = caption.charAt(0).toUpperCase() + caption.slice(1);
  const weekRangeText = formatWeekRange(weekStartDate, addDays(weekStartDate, 6), locale);

  return (
    <div
      data-calendar-card
      className={cn('relative max-w-full min-w-0 rounded-xl border border-line bg-card p-2 sm:p-3', muted && 'pointer-events-none')}
    >
      <div className="mb-2 flex min-h-10 w-full items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-base font-bold text-primary">{captionLabel}</div>
          {view === 'week' && (
            <div className="truncate text-xs font-medium text-muted-foreground">
              {t('posts.calendarWeekLabel', { range: weekRangeText })}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {showViewSwitcher && (
            <div
              role="group"
              aria-label={t('posts.calendarViewSwitcher')}
              className="hidden items-center gap-0.5 rounded-md border border-input bg-card p-0.5 md:flex"
            >
              <button
                type="button"
                onClick={() => onViewChange('month')}
                disabled={muted}
                aria-pressed={view === 'month'}
                className={cn(
                  'h-9 rounded-md px-3 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  view === 'month' ? 'bg-brand text-white hover:bg-brand-hover' : 'text-primary hover:bg-sunken',
                )}
              >
                {t('posts.calendarViewMonth')}
              </button>
              <button
                type="button"
                onClick={() => onViewChange('week')}
                disabled={muted}
                aria-pressed={view === 'week'}
                className={cn(
                  'h-9 rounded-md px-3 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  view === 'week' ? 'bg-brand text-white hover:bg-brand-hover' : 'text-primary hover:bg-sunken',
                )}
              >
                {t('posts.calendarViewWeek')}
              </button>
            </div>
          )}
          <nav className="flex shrink-0 items-center gap-0.5" aria-label={captionLabel}>
            <button
              type="button"
              onClick={() => (view === 'week' ? onWeekNavigate(prevWeek) : onMonthNavigate(prev.year, prev.month))}
              disabled={muted}
              aria-label={t(view === 'week' ? 'posts.calendarPrevWeek' : 'posts.calendarPrevMonth')}
              className={NAV_ARROW_CLASS}
            >
              <ChevronLeft aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => (view === 'week' ? onWeekNavigate(nextWeek) : onMonthNavigate(next.year, next.month))}
              disabled={muted}
              aria-label={t(view === 'week' ? 'posts.calendarNextWeek' : 'posts.calendarNextMonth')}
              className={NAV_ARROW_CLASS}
            >
              <ChevronRight aria-hidden />
            </button>
            <button
              type="button"
              onClick={onGoToToday}
              disabled={muted}
              aria-pressed={todayPressed}
              className={cn(
                'h-10 rounded-md px-3 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                todayPressed ? 'bg-brand text-white hover:bg-brand-hover' : 'border border-input bg-card text-primary hover:bg-sunken',
              )}
            >
              {t('posts.calendarGoToToday')}
            </button>
          </nav>
        </div>
      </div>
      <CalendarProvider
        events={events}
        view={view}
        date={date}
        onDateChange={onDateChange}
        weekStartsOn={weekStartsOn}
        locale={dateFnsLocale}
        hourCycle={locale === 'pt' ? 24 : 12}
        loading={loading}
        secondaryTimeZone={secondaryTimeZone}
        createEvent={() => null}
        onEventSelect={handleEventSelect}
      >
        {view === 'week' ? (
          <div
            ref={weekWrapRef}
            data-posts-calendar-week
            className="h-150"
            onPointerDownCapture={handleEventPointerDownCapture}
            onClickCapture={handleGridClickCapture}
            onContextMenuCapture={handleEventContextMenuCapture}
            onKeyDownCapture={handleEventKeyDownCapture}
          >
            <WeekView showEventPopover={false} />
          </div>
        ) : (
          <div
            data-posts-calendar-month
            className="h-150"
            onClick={handleGridClick}
            onPointerDownCapture={handleEventPointerDownCapture}
            onClickCapture={handleGridClickCapture}
            onContextMenuCapture={handleEventContextMenuCapture}
            onKeyDownCapture={handleEventKeyDownCapture}
          >
            <MonthView showEventPopover={false} />
          </div>
        )}
      </CalendarProvider>
    </div>
  );
}
