'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
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
import { useTimeZoneLabel } from '@/hooks/use-timezone-label';
import { cn } from '@/lib/utils';
import { addDays, dayKey, weekStart } from './calendar-days';
import { readSecondaryTimeZone } from './secondary-timezone';

const NAV_ARROW_CLASS =
  'inline-flex size-10 min-h-10 min-w-10 shrink-0 items-center justify-center rounded-md p-0 text-ink transition-colors select-none hover:bg-sunken active:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:opacity-50 [&_svg]:size-6 [&_svg]:stroke-[2.5] [&_svg]:text-ink';

const DRAG_THRESHOLD_PX = 4;

export type PostsCalendarView = 'month' | 'week';

export function formatWeekRange(start: Date, end: Date, locale: Locale): string {
  const dateFnsLocale = locale === 'pt' ? ptBR : enUS;
  const monthAbbr = (day: Date): string => {
    const abbr = format(day, 'MMM', { locale: dateFnsLocale });
    return abbr.charAt(0).toUpperCase() + abbr.slice(1);
  };
  if (start.getMonth() === end.getMonth()) return `${format(start, 'd')} – ${format(end, 'd')} ${monthAbbr(end)}`;
  return `${format(start, 'd')} ${monthAbbr(start)} – ${format(end, 'd')} ${monthAbbr(end)}`;
}

export function dayColumnIndexForPoint(
  clientX: number,
  columns: Array<{ left: number; right: number }>,
): number {
  return columns.findIndex(({ left, right }) => clientX >= left && clientX < right);
}

export interface PostsCalendarProps {
  events: DetailedCalendarEvent[];
  date: Date;
  view: PostsCalendarView;
  mobileWeek?: boolean;
  showViewSwitcher: boolean;
  weekStartsOn: 0 | 1;
  locale: Locale;
  loading: boolean;
  muted?: boolean;
  todayPressed: boolean;
  onDateChange: (date: Date) => void;
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
  mobileWeek = false,
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
  const dragStartRef = useRef<{ x: number; y: number; eventId: string | null } | null>(null);
  const weekWrapRef = useRef<HTMLDivElement | null>(null);
  const [secondaryTimeZone] = useState(readSecondaryTimeZone);
  const weekStartDate = view === 'week' ? weekStart(date, weekStartsOn) : date;
  const viewerZoneLabel = useTimeZoneLabel();
  const monthRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = monthRef.current;
    if (el === null) return;
    const blockWheelNav = (event: WheelEvent) => event.stopPropagation();
    el.addEventListener('wheel', blockWheelNav, { capture: true });
    return () => el.removeEventListener('wheel', blockWheelNav, { capture: true });
  }, []);

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
    event.stopPropagation();
  }, []);

  const handleGridClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const start = dragStartRef.current;
      dragStartRef.current = null;
      if (start !== null && start.eventId !== null) {
        const eventId = (event.target as HTMLElement).closest('[data-event-id]')?.getAttribute('data-event-id');
        if (eventId === start.eventId) {
          const moved =
            Math.abs(event.clientX - start.x) > DRAG_THRESHOLD_PX || Math.abs(event.clientY - start.y) > DRAG_THRESHOLD_PX;
          if (moved) {
            event.stopPropagation();
            return;
          }
        }
      }
      if (view !== 'week') return;
      if (muted) return;
      const target = event.target as HTMLElement;
      if (target.closest('[data-event-id]')) return;
      const wrapper = weekWrapRef.current;
      if (wrapper === null) return;
      const columns = [...wrapper.querySelectorAll('[role="group"][aria-label]:not([inert])')];
      let index = -1;
      const column = target.closest('[role="group"][aria-label]');
      if (column !== null) index = columns.indexOf(column);
      if (index === -1) {
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
    if ((event.target as HTMLElement).closest('[data-event-id]')) event.stopPropagation();
  }, []);

  const handleEventKeyDownCapture = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.altKey && (event.target as HTMLElement).closest('[data-event-id]')) {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
      }
    }
  }, []);

  const prev = shiftMonth(date, -1);
  const next = shiftMonth(date, 1);
  const prevWeek = addDays(date, -7);
  const nextWeek = addDays(date, 7);
  const dateFnsLocale = locale === 'pt' ? ptBR : enUS;
  const caption = format(date, 'LLLL yyyy', { locale: dateFnsLocale });
  const captionLabel = caption.charAt(0).toUpperCase() + caption.slice(1);
  const weekRangeText = formatWeekRange(weekStartDate, addDays(weekStartDate, 6), locale);
  const weekLabel = t('posts.calendarWeekLabel', { range: weekRangeText });
  const weekSubtitle = view === 'week' && mobileWeek && viewerZoneLabel ? `${weekLabel} · ${viewerZoneLabel}` : weekLabel;

  return (
    <div
      data-calendar-card
      className={cn('relative max-w-full min-w-0 rounded-xl border border-line bg-card p-2 sm:p-3', muted && 'pointer-events-none')}
    >
      <div className="mb-2 flex w-full flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
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
          </nav>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold text-primary sm:text-base">{captionLabel}</div>
            {view === 'week' && (
              <div className="truncate text-xs font-medium text-muted-foreground">{weekSubtitle}</div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {showViewSwitcher && (
            <div
              role="group"
              aria-label={t('posts.calendarViewSwitcher')}
              className="flex items-center gap-0.5 rounded-md border border-input bg-card p-0.5"
            >
              <button
                type="button"
                onClick={() => onViewChange('month')}
                disabled={muted}
                aria-pressed={view === 'month'}
                className={cn(
                  'h-9 rounded-md px-2 text-[13px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:px-3 sm:text-sm',
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
                  'h-9 rounded-md px-2 text-[13px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:px-3 sm:text-sm',
                  view === 'week' ? 'bg-brand text-white hover:bg-brand-hover' : 'text-primary hover:bg-sunken',
                )}
              >
                {t('posts.calendarViewWeek')}
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={onGoToToday}
            disabled={muted}
            aria-pressed={todayPressed}
            className={cn(
              'hidden h-10 rounded-md px-3 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:inline-flex sm:items-center',
              todayPressed ? 'bg-brand text-white hover:bg-brand-hover' : 'border border-input bg-card text-primary hover:bg-sunken',
            )}
          >
            {t('posts.calendarGoToToday')}
          </button>
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
        secondaryTimeZone={mobileWeek ? undefined : secondaryTimeZone}
        createEvent={() => null}
        onEventSelect={handleEventSelect}
      >
        {view === 'week' ? (
          <>
            <div
              ref={weekWrapRef}
              data-posts-calendar-week
              data-mobile-week={mobileWeek || undefined}
              role="group"
              aria-label={captionLabel}
              className="h-150"
              onPointerDownCapture={handleEventPointerDownCapture}
              onClickCapture={handleGridClickCapture}
              onContextMenuCapture={handleEventContextMenuCapture}
              onKeyDownCapture={handleEventKeyDownCapture}
            >
              <WeekView showEventPopover={false} />
            </div>
          </>
        ) : (
          <>
            {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
            <div
              ref={monthRef}
              data-posts-calendar-month
              role="group"
              aria-label={captionLabel}
              className="h-150"
              onClick={handleGridClick}
              onPointerDownCapture={handleEventPointerDownCapture}
              onClickCapture={handleGridClickCapture}
              onContextMenuCapture={handleEventContextMenuCapture}
              onKeyDownCapture={handleEventKeyDownCapture}
            >
              <MonthView showEventPopover={false} />
            </div>
          </>
        )}
      </CalendarProvider>
    </div>
  );
}
