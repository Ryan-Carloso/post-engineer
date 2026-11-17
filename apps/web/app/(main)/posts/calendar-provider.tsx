'use client';

import { useCallback, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { enUS, ptBR } from 'date-fns/locale';
import { format } from 'date-fns';
import { CalendarProvider } from '@/components/calendar-provider';
import { MonthView } from '@/components/month-view';
import type { DetailedCalendarEvent } from '@/components/calendar-types';
import { useI18n } from '@/lib/i18n/provider';
import type { Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

//---------------
// PostsCalendar — the /posts month grid on CalendarCN's MonthView.
//
// Read-only in this slice: events are controlled by the page, a click on a
// chip navigates to the post detail, a click on a day selects it for the
// day panel. The lib has no readOnly switch, so the edit paths are stopped
// here, at the wrapper, instead of inside the lib:
// - drag/resize start on pointerdown over an event: stopped in capture, so
//   no ghost ever follows the pointer and a drop commits nothing;
// - the click that follows a drag is swallowed in capture, so a drag never
//   navigates either (a plain click still does);
// - the event context menu and Alt+Arrow keyboard moves are stopped the
//   same way; the details popover is off (showEventPopover={false}).
// Remove these guards when a later slice wires drag to reschedule.
//---------------

// The month's toolbar chevrons: one size, ink chevrons, 40px touch target.
const NAV_ARROW_CLASS =
  'inline-flex size-10 min-h-10 min-w-10 shrink-0 items-center justify-center rounded-md p-0 text-ink transition-colors select-none hover:bg-sunken active:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:opacity-50 [&_svg]:size-6 [&_svg]:stroke-[2.5] [&_svg]:text-ink';

// How far a press may wander before its trailing click counts as a drag.
const DRAG_THRESHOLD_PX = 4;

export interface PostsCalendarProps {
  events: DetailedCalendarEvent[];
  /** First day of the shown month, owned by the page. */
  date: Date;
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
  onGoToToday: () => void;
}

function shiftMonth(date: Date, delta: number): { year: number; month: number } {
  const shifted = new Date(date.getFullYear(), date.getMonth() + delta, 1);
  return { year: shifted.getFullYear(), month: shifted.getMonth() };
}

export function PostsCalendar({
  events,
  date,
  weekStartsOn,
  locale,
  loading,
  muted = false,
  todayPressed,
  onDateChange,
  onSelectDay,
  onMonthNavigate,
  onGoToToday,
}: PostsCalendarProps) {
  const { t } = useI18n();
  const router = useRouter();
  // Where the last press on an event started, to tell a drag from a click.
  const dragStartRef = useRef<{ x: number; y: number; eventId: string } | null>(null);

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
    const eventId = (event.target as HTMLElement).closest('[data-event-id]')?.getAttribute('data-event-id');
    if (!eventId) return;
    // Read-only: the lib's drag/resize start here. Stopping the press keeps
    // the ghost, the drop commit and the drag's trailing selection away.
    event.stopPropagation();
    dragStartRef.current = { x: event.clientX, y: event.clientY, eventId };
  }, []);

  const handleClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (!start) return;
    const eventId = (event.target as HTMLElement).closest('[data-event-id]')?.getAttribute('data-event-id');
    if (eventId !== start.eventId) return;
    const moved = Math.abs(event.clientX - start.x) > DRAG_THRESHOLD_PX || Math.abs(event.clientY - start.y) > DRAG_THRESHOLD_PX;
    if (moved) event.stopPropagation();
  }, []);

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
  const dateFnsLocale = locale === 'pt' ? ptBR : enUS;
  // The caption is the old grid's: date-fns "LLLL yyyy" ("Novembro 2026",
  // "November 2026") — the panel heading's Intl string ("novembro de
  // 2026") carries a "de" the caption never had. The first letter is
  // capped here, not in CSS: Tailwind emits no `first-letter:uppercase`
  // rule in this build.
  const caption = format(date, 'LLLL yyyy', { locale: dateFnsLocale });
  const captionLabel = caption.charAt(0).toUpperCase() + caption.slice(1);

  return (
    <div
      data-calendar-card
      className={cn('relative max-w-full min-w-0 rounded-xl border border-line bg-card p-2 sm:p-3', muted && 'pointer-events-none')}
    >
      <div className="mb-2 flex min-h-10 w-full items-center justify-between gap-2">
        <div className="min-w-0 truncate text-base font-bold text-primary">{captionLabel}</div>
        <nav className="flex shrink-0 items-center gap-0.5" aria-label={captionLabel}>
          <button
            type="button"
            onClick={() => onMonthNavigate(prev.year, prev.month)}
            disabled={muted}
            aria-label={t('posts.calendarPrevMonth')}
            className={NAV_ARROW_CLASS}
          >
            <ChevronLeft aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => onMonthNavigate(next.year, next.month)}
            disabled={muted}
            aria-label={t('posts.calendarNextMonth')}
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
      <CalendarProvider
        events={events}
        view="month"
        date={date}
        onDateChange={onDateChange}
        weekStartsOn={weekStartsOn}
        locale={dateFnsLocale}
        hourCycle={locale === 'pt' ? 24 : 12}
        loading={loading}
        createEvent={() => null}
        onEventSelect={handleEventSelect}
      >
        <div
          data-posts-calendar-month
          className="h-150"
          onClick={handleGridClick}
          onPointerDownCapture={handleEventPointerDownCapture}
          onClickCapture={handleClickCapture}
          onContextMenuCapture={handleEventContextMenuCapture}
          onKeyDownCapture={handleEventKeyDownCapture}
        >
          <MonthView showEventPopover={false} />
        </div>
      </CalendarProvider>
    </div>
  );
}
