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

function CalendarGridOutline() {
  return (
    <div
      aria-hidden
      data-calendar-grid-outline
      className="mx-auto grid max-w-lg grid-cols-7 gap-1.5 px-1 py-3"
    >
      {Array.from({ length: 21 }, (_, index) => (
        <div key={index} className="mx-auto h-9 w-full max-w-[2.5rem] rounded-md border border-dashed border-line/80" />
      ))}
    </div>
  );
}

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
  onLoadErrorRetry?: () => void;
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
}

const NavTodayContext = createContext<NavTodayValue>({ go: () => {}, pressed: false });

// The month navigation: previous month, Today, next month. Mirrors
// react-day-picker's default Nav (same buttons, labels and disabled
// behaviour) with the Today action between the arrows.
function CalendarNav({ onPreviousClick, onNextClick, previousMonth, nextMonth, ...navProps }: NavProps) {
  const { components, classNames, styles, labels } = useDayPicker();
  const { t } = useI18n();
  const today = useContext(NavTodayContext);
  const handlePreviousClick: MouseEventHandler<HTMLButtonElement> = useCallback(
    (event) => {
      if (previousMonth) onPreviousClick?.(event);
    },
    [previousMonth, onPreviousClick],
  );
  const handleNextClick: MouseEventHandler<HTMLButtonElement> = useCallback(
    (event) => {
      if (nextMonth) onNextClick?.(event);
    },
    [nextMonth, onNextClick],
  );
  return (
    <nav {...navProps}>
      <components.PreviousMonthButton
        type="button"
        className={classNames[UI.PreviousMonthButton]}
        style={styles?.[UI.PreviousMonthButton]}
        tabIndex={previousMonth ? undefined : -1}
        aria-disabled={previousMonth ? undefined : true}
        aria-label={labels.labelPrevious(previousMonth)}
        onClick={handlePreviousClick}
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
        onClick={today.go}
        aria-pressed={today.pressed}
        className={cn(
          'h-10 rounded-md px-3 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          today.pressed
            ? 'bg-primary text-on-ink hover:bg-accent-hover'
            : 'border border-input bg-card text-primary hover:bg-sunken',
        )}
      >
        {t('posts.calendarToday')}
      </button>
      <components.NextMonthButton
        type="button"
        className={classNames[UI.NextMonthButton]}
        style={styles?.[UI.NextMonthButton]}
        tabIndex={nextMonth ? undefined : -1}
        aria-disabled={nextMonth ? undefined : true}
        aria-label={labels.labelNext(nextMonth)}
        onClick={handleNextClick}
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
  onLoadErrorRetry,
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
    () => ({ go: goToday, pressed: !unavailable && !muted && selectedKey === todayKey }),
    [goToday, unavailable, muted, selectedKey, todayKey],
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
        unavailable && 'pb-1',
      )}
    >
      <DayCellContext.Provider value={dayCells}>
        <CalendarChromeContext.Provider value={chrome}>
        <NavTodayContext.Provider value={navToday}>
          <div
            className={cn(
              !unavailable && 'max-xl:max-h-[min(40vh,17rem)] max-xl:overflow-y-auto max-xl:overscroll-contain',
            )}
          >
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
              nav: 'absolute right-0 top-0 flex items-center gap-1',
              button_previous: NAV_ARROW_CLASS,
              button_next: NAV_ARROW_CLASS,
              month_caption: 'flex min-h-(--cell-size) w-full items-center justify-start pr-44',
              weekdays: unavailable ? 'hidden' : 'table-row',
              // Equal table cells so seven columns stay aligned on narrow screens.
              weekday:
                'table-cell min-w-0 w-[14.2857%] select-none px-0.5 pb-1 text-center text-xs font-medium capitalize text-muted-foreground max-xl:sticky max-xl:top-0 max-xl:z-[1] max-xl:bg-card',
              week: 'table-row',
              // table-fixed: a table sizes columns from cell content, so a
              // busy day's chips were widening the month past the screen.
              month_grid: unavailable ? 'hidden' : 'w-full table-fixed border-collapse',
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
          {unavailable && <CalendarGridOutline />}
          {unavailable && loadErrorMessageKey !== undefined && onLoadErrorRetry !== undefined && (
            <div data-calendar-load-error className="px-1 pt-1">
              <LoadErrorBanner compact messageKey={loadErrorMessageKey} onRetry={onLoadErrorRetry} />
            </div>
          )}
        </NavTodayContext.Provider>
        </CalendarChromeContext.Provider>
      </DayCellContext.Provider>
      {legendVisible && !unavailable && (
        <div className={cn('mt-3 hidden xl:block', legendClassName)}>
          <CalendarLegend filtered={filtered} />
        </div>
      )}
    </div>
  );
}

export { CalendarLegend } from './calendar-legend';
