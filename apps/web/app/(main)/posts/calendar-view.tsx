'use client';

import { createContext, useCallback, useContext, useMemo, type MouseEventHandler } from 'react';
import { UI, useDayPicker, type NavProps } from 'react-day-picker';
import { enUS, ptBR } from 'react-day-picker/locale';
import type { ScheduleConfig, ScheduledSlot } from '@/lib/api';
import type { Locale, TranslationKey } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/provider';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { INTL_TAG, calendarCounts, dateFromKey, dayKey } from './calendar-days';
import { CALENDAR_GROUP_KEY, CALENDAR_GROUP_ORDER } from './status';
import { DayCellContext, PostsDayButton } from './calendar-markers';
import { CalendarChromeContext, PostsCalendarWeek, PostsCalendarWeeks } from './calendar-week';
import { CalendarLegend } from './calendar-legend';
import { LoadErrorBanner } from './day-section';

// CalendarView — month calendar on the shadcn Calendar (react-day-picker:
// grid semantics, keyboard navigation, focus). Each day cell shows up to
// two status icons plus an overflow count per day, failure first
// (calendar-markers.tsx); the legend draws the same markers. Today is an
// amber disc behind the day number. The selected day is an outlined cell,
// so the two never look alike. The grid shows only the weeks the month
// spans (no all-next-month sixth row). Day buckets use the viewer's
// browser timezone (calendar-days.ts). Data and the selected day's posts
// live in the page. `unavailable` (the posts failed to load) disables the
// days without washing the numbers out, and drops the selection and the
// legend, so a failed load never reads as an empty month; the month
// navigation stays usable. `muted` is the account-empty calendar: the same
// readable grid, not interactive.

interface CalendarViewProps {
  year: number;
  month: number; // 0-based
  firstWeekday: 0 | 1;
  slotsByDay: Map<string, Pick<ScheduledSlot, 'status' | 'scheduleId' | 'slotAt'>[]>;
  scheduleById: Map<string, Pick<ScheduleConfig, 'personaId'>>;
  personaPhotoById: Map<string, { name: string }>;
  selectedKey: string | null;
  todayKey: string;
  onSelect: (key: string) => void;
  onMonthChange: (year: number, month: number) => void;
  // Explicit month-button navigation (prev/next): the page moves the
  // selected day into the new month, so the month and the detail below it
  // never diverge. onMonthChange alone cannot do this — react-day-picker
  // also fires it when arrow-key focus crosses a month edge, where moving
  // the selection would fight the keyboard.
  onMonthNavigate: (year: number, month: number) => void;
  // The posts could not be loaded: days stay readable but do not select.
  unavailable?: boolean;
  // Account with no posts: the grid stays as the page frame, inert.
  muted?: boolean;
  // A network/account filter hides some posts: the legend says so.
  filtered?: boolean;
  // Extra classes on the legend wrapper (the page hides the in-card copy
  // below `xl` and draws one under the day list instead).
  legendClassName?: string;
  // Hide status chips and the legend when the month has no posts.
  showLegend?: boolean;
  loadErrorMessageKey?: TranslationKey;
  loadErrorNoteKey?: TranslationKey;
  onLoadErrorRetry?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

const DAY_PICKER_LOCALE: Record<Locale, typeof enUS> = { pt: ptBR, en: enUS };

// The month arrows. One size, ink chevrons (the old primary-on-sunken
// arrow was easy to miss, and an active fill stayed down after a click).
// Hover tints; there is no stuck active fill. The target is 40px for touch.
const NAV_ARROW_CLASS =
  'inline-flex size-10 items-center justify-center rounded-md p-0 text-ink transition-colors select-none hover:bg-sunken active:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:opacity-50 [&_svg]:size-5 [&_svg]:stroke-[2.5] [&_svg]:text-ink';

// The Today action lives inside the month navigation (prev / Today / next),
// so the nav component needs it from context: passing a closure component
// to react-day-picker would remount the nav on every render and drop
// keyboard focus. Pressed (today is the selected day) is a solid fill of
// the same size — never a disabled-looking label — so the arrows never shift.
interface NavTodayValue {
  go: () => void;
  pressed: boolean;
  unavailable: boolean;
  onRetry?: () => void;
}

const NavTodayContext = createContext<NavTodayValue>({ go: () => {}, pressed: false, unavailable: false });

// The month navigation: previous month, Today, next month. Mirrors
// react-day-picker's default Nav (same buttons, labels and disabled
// behaviour) with the Today action between the arrows.
function CalendarNav({ onPreviousClick, onNextClick, previousMonth, nextMonth, ...navProps }: NavProps) {
  const { components, classNames, styles, labels } = useDayPicker();
  const { t } = useI18n();
  const today = useContext(NavTodayContext);
  const handlePreviousClick: MouseEventHandler<HTMLButtonElement> = useCallback(
    (event) => {
      if (today.unavailable) return;
      if (previousMonth) onPreviousClick?.(event);
    },
    [previousMonth, onPreviousClick, today.unavailable],
  );
  const handleNextClick: MouseEventHandler<HTMLButtonElement> = useCallback(
    (event) => {
      if (today.unavailable) return;
      if (nextMonth) onNextClick?.(event);
    },
    [nextMonth, onNextClick, today.unavailable],
  );
  const handleTodayClick: MouseEventHandler<HTMLButtonElement> = useCallback(() => {
    if (today.unavailable) return;
    today.go();
  }, [today]);
  const navInert = today.unavailable;
  const navDisabledClass =
    'pointer-events-none cursor-not-allowed border border-line bg-sunken/80 text-muted-foreground opacity-70 shadow-none hover:bg-sunken/80 hover:text-muted-foreground active:bg-sunken/80 [&_svg]:text-muted-foreground';
  return (
    <nav
      {...navProps}
      className={cn(
        navProps.className,
        navInert && '[&_button]:pointer-events-none',
      )}
      aria-disabled={navInert ? true : undefined}
    >
      <components.PreviousMonthButton
        type="button"
        className={cn(classNames[UI.PreviousMonthButton], navInert && navDisabledClass)}
        style={styles?.[UI.PreviousMonthButton]}
        tabIndex={navInert || !previousMonth ? -1 : undefined}
        aria-disabled={navInert || !previousMonth ? true : undefined}
        aria-label={labels.labelPrevious(previousMonth)}
        onClick={handlePreviousClick}
        disabled={navInert}
      >
        <components.Chevron
          disabled={previousMonth ? undefined : true}
          className={classNames[UI.Chevron]}
          style={styles?.[UI.Chevron]}
          orientation="left"
        />
      </components.PreviousMonthButton>
      <button
        type="button"
        onClick={handleTodayClick}
        disabled={navInert}
        aria-pressed={navInert ? undefined : today.pressed}
        className={cn(
          'h-10 rounded-md px-3 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          navInert && navDisabledClass,
          !navInert &&
            (today.pressed
              ? 'bg-primary text-on-ink hover:bg-accent-hover'
              : 'border border-input bg-card text-primary hover:bg-sunken'),
        )}
      >
        {t('posts.calendarGoToToday')}
      </button>
      <components.NextMonthButton
        type="button"
        className={cn(classNames[UI.NextMonthButton], navInert && navDisabledClass)}
        style={styles?.[UI.NextMonthButton]}
        tabIndex={navInert || !nextMonth ? -1 : undefined}
        aria-disabled={navInert || !nextMonth ? true : undefined}
        aria-label={labels.labelNext(nextMonth)}
        onClick={handleNextClick}
        disabled={navInert}
      >
        <components.Chevron
          disabled={nextMonth ? undefined : true}
          className={classNames[UI.Chevron]}
          style={styles?.[UI.Chevron]}
          orientation="right"
        />
      </components.NextMonthButton>
    </nav>
  );
}

export function CalendarView({
  year,
  month,
  firstWeekday,
  slotsByDay,
  scheduleById: _scheduleById,
  personaPhotoById: _personaPhotoById,
  selectedKey,
  todayKey,
  onSelect,
  onMonthChange,
  onMonthNavigate,
  unavailable = false,
  muted = false,
  filtered = false,
  legendClassName,
  showLegend = true,
  loadErrorMessageKey,
  loadErrorNoteKey,
  onLoadErrorRetry,
  onRefresh,
  refreshing = false,
}: CalendarViewProps) {
  const { t, locale } = useI18n();
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(INTL_TAG[locale], { dateStyle: 'full' }), [locale]);
  // Weekday headers from Intl, not react-day-picker's date-fns names: the
  // pt-BR ones keep their accent ("sáb", not "sab"). Intl's short pt-BR
  // names end in a period ("sáb."), dropped for the column header, and are
  // lowercase: the header capitalizes them, like the English ones.
  const formatters = useMemo(() => {
    const weekdayFormat = new Intl.DateTimeFormat(INTL_TAG[locale], { weekday: 'short' });
    return { formatWeekdayName: (date: Date) => weekdayFormat.format(date).replace(/\.$/, '') };
  }, [locale]);

  // Memoized so a data refresh that leaves slotsByDay untouched hands
  // react-day-picker the same label function (and labels object) instead of
  // a new one on every render, which would re-render the day buttons.
  const labelDayButton = useCallback(
    (date: Date): string => {
      const slots = slotsByDay.get(dayKey(date)) ?? [];
      const fullDate = dateFormat.format(date);
      if (slots.length === 0) return t('posts.calendarDayEmpty', { date: fullDate });
      const counts = calendarCounts(slots);
      const summary = CALENDAR_GROUP_ORDER.filter((group) => counts[group] > 0)
        .map((group) => `${t(CALENDAR_GROUP_KEY[group])}: ${counts[group]}`)
        .join(', ');
      return t('posts.calendarDayLabel', { date: fullDate, summary });
    },
    [slotsByDay, dateFormat, t],
  );
  const labels = useMemo(
    () => ({
      labelDayButton,
      labelPrevious: () => t('posts.calendarPrevMonth'),
      labelNext: () => t('posts.calendarNextMonth'),
    }),
    [labelDayButton, t],
  );

  // The Today action in the month navigation: jump the shown month to today
  // and select today (a no-op when both already hold).
  const goToday = useCallback(() => {
    const now = dateFromKey(todayKey);
    onMonthChange(now.getFullYear(), now.getMonth());
    onSelect(todayKey);
  }, [todayKey, onMonthChange, onSelect]);
  const navToday = useMemo<NavTodayValue>(
    () => ({
      go: goToday,
      pressed: !unavailable && !muted && selectedKey === todayKey,
      unavailable,
      onRetry: onLoadErrorRetry,
    }),
    [goToday, unavailable, muted, selectedKey, todayKey, onLoadErrorRetry],
  );
  const inert = unavailable || muted;
  const monthHasPosts = useMemo(() => [...slotsByDay.values()].some((slots) => slots.length > 0), [slotsByDay]);
  const legendVisible = showLegend && monthHasPosts && !inert;
  // Unavailable or muted: no markers from whatever part did load.
  const dayCells = useMemo(() => ({ slotsByDay: inert ? new Map() : slotsByDay }), [inert, slotsByDay]);
  const chrome = useMemo(() => ({ filtered, showLegend: legendVisible }), [filtered, legendVisible]);

  return (
    <div
      data-calendar-card
      className={cn(
        'relative max-w-full min-w-0 rounded-xl border border-line bg-card p-2 sm:p-3',
        muted && 'pointer-events-none',
      )}
    >
      <DayCellContext.Provider value={dayCells}>
        <CalendarChromeContext.Provider value={chrome}>
        <NavTodayContext.Provider value={navToday}>
          {unavailable && loadErrorMessageKey !== undefined && onLoadErrorRetry !== undefined ? (
            <div
              data-calendar-load-error
              className="flex min-h-[22rem] flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive-soft/50 p-4 sm:p-6 xl:min-h-[24rem]"
            >
              <LoadErrorBanner
                compact
                fill
                bare
                messageKey={loadErrorMessageKey}
                noteKey={loadErrorNoteKey}
                onRetry={onLoadErrorRetry}
              />
            </div>
          ) : (
          <div className="max-xl:overflow-x-hidden max-xl:overflow-visible">
          {legendVisible && (
            <div className={cn('mb-2 border-b border-line pb-2', legendClassName)}>
              <CalendarLegend filtered={filtered} />
            </div>
          )}
          <Calendar
            mode="single"
            required
            locale={DAY_PICKER_LOCALE[locale]}
            weekStartsOn={firstWeekday}
            month={new Date(year, month, 1)}
            onMonthChange={(date) => onMonthChange(date.getFullYear(), date.getMonth())}
            onNextClick={(date) => onMonthNavigate(date.getFullYear(), date.getMonth())}
            onPrevClick={(date) => onMonthNavigate(date.getFullYear(), date.getMonth())}
            today={inert ? undefined : dateFromKey(todayKey)}
            selected={selectedKey === null || inert ? undefined : dateFromKey(selectedKey)}
            disabled={inert}
            onSelect={(date) => onSelect(dayKey(date))}
            labels={labels}
            formatters={formatters}
            className="w-full bg-transparent p-0 [--cell-size:--spacing(10)]"
            classNames={{
              root: 'w-full',
              caption_label: 'text-base font-bold capitalize text-primary',
              // The nav clusters right (prev / Today / next) and the caption
              // title left-aligns with room to its right, so the title
              // never runs under the navigation.
              nav: 'absolute right-0 top-0 flex shrink-0 items-center gap-0.5 pr-0.5 max-xl:gap-1',
              button_previous: NAV_ARROW_CLASS,
              button_next: NAV_ARROW_CLASS,
              month_caption:
                'flex min-h-(--cell-size) w-full items-center justify-start pr-[10.75rem] max-xl:pr-[10.25rem] sm:pr-44',
              weekdays: 'table-row',
              // Equal table cells so seven columns stay aligned on narrow screens.
              weekday:
                'table-cell min-w-0 w-[14.2857%] select-none px-0.5 pb-1 text-center text-xs font-medium capitalize text-muted-foreground max-xl:sticky max-xl:top-0 max-xl:z-[1] max-xl:bg-card',
              week: 'table-row',
              // table-fixed: a table sizes columns from cell content, so a
              // busy day's chips were widening the month past the screen.
              month_grid: 'w-full table-fixed border-collapse',
              // Today is drawn by the day number itself (see PostsDayButton):
              // drop shadcn's accent fill so today never reads as selected.
              today: 'rounded-md [&:not([data-selected-single=true])]:bg-transparent',
              outside:
                'text-muted-foreground [&_button]:text-muted-foreground [&_button]:hover:bg-transparent [&_button]:active:bg-transparent',
              // Disabled days (a failed load, or an account with no posts)
              // keep readable numbers. shadcn's default fades them to 50%.
              disabled: 'text-primary opacity-100',
              // Equal share of the fixed table. The chip row clips itself; the
              // cell does not, or it would crop the selection outline.
              day: 'group/day relative min-w-0 w-[14.2857%] table-cell p-0 text-center align-top',
            }}
            components={{ DayButton: PostsDayButton, Nav: CalendarNav, Week: PostsCalendarWeek, Weeks: PostsCalendarWeeks }}
          />
          </div>
          )}
        </NavTodayContext.Provider>
        </CalendarChromeContext.Provider>
      </DayCellContext.Provider>
    </div>
  );
}

export { CalendarLegend } from './calendar-legend';
