'use client';

import { createContext, useCallback, useContext, useMemo, type MouseEventHandler } from 'react';
import { UI, useDayPicker, type NavProps } from 'react-day-picker';
import { enUS, ptBR } from 'react-day-picker/locale';
import type { ScheduleConfig, ScheduledSlot } from '@/lib/api';
import type { Locale } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/provider';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { INTL_TAG, calendarCounts, dateFromKey, dayKey, dayPersonas, monthKey, type PersonaPhoto } from './calendar-days';
import { CALENDAR_GROUP_KEY, CALENDAR_GROUP_ORDER } from './status';
import { DayCellContext, PostsDayButton, StatusMarker, TODAY_MARK_CLASS } from './calendar-markers';

// CalendarView — month calendar on the shadcn Calendar (react-day-picker:
// grid semantics, keyboard navigation, focus). Each day cell shows up to
// three of the day's personas and one status marker per group, failure
// first (calendar-markers.tsx); the legend below the grid draws the very
// same markers. Today is a filled blue disc behind the day number, the
// selected day fills the whole cell, so the two never look alike. The grid
// shows only the weeks the month spans (no all-next-month sixth row). Day
// buckets use the viewer's browser timezone (calendar-days.ts). Data and
// the selected day's posts live in the page.

interface CalendarViewProps {
  year: number;
  month: number; // 0-based
  firstWeekday: 0 | 1;
  slotsByDay: Map<string, Pick<ScheduledSlot, 'status' | 'scheduleId' | 'slotAt'>[]>;
  scheduleById: Map<string, Pick<ScheduleConfig, 'personaId'>>;
  personaPhotoById: Map<string, PersonaPhoto>;
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
}

const DAY_PICKER_LOCALE: Record<Locale, typeof enUS> = { pt: ptBR, en: enUS };
const MAX_CELL_PERSONAS = 3;

// The month arrows. shadcn's ghost button hovers to the navy accent fill
// with no matching foreground token, so a hovered (or just-clicked) arrow
// became a solid navy square hiding its navy chevron. These states only
// tint, and the target is 40px for touch.
const NAV_ARROW_CLASS =
  'inline-flex size-10 items-center justify-center rounded-md p-0 text-primary transition-colors select-none hover:bg-sunken active:bg-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:opacity-50 [&_svg]:size-5';

// The Today action lives inside the month navigation (prev / Today / next),
// so the nav component needs it from context: passing a closure component
// to react-day-picker would remount the nav on every render and drop
// keyboard focus. `onToday` disables it when today is already shown and
// selected.
const NavTodayContext = createContext<{ goToday: () => void; onToday: boolean }>({ goToday: () => {}, onToday: false });

// The month navigation: previous month, Today, next month. Mirrors
// react-day-picker's default Nav (same buttons, labels and disabled
// behaviour) with the Today action between the arrows.
function CalendarNav({ onPreviousClick, onNextClick, previousMonth, nextMonth, ...navProps }: NavProps) {
  const { components, classNames, styles, labels } = useDayPicker();
  const { t } = useI18n();
  const { goToday, onToday } = useContext(NavTodayContext);
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
        onClick={goToday}
        disabled={onToday}
        className="h-10 rounded-md border border-input bg-card px-3 text-sm font-semibold text-primary transition-colors hover:bg-sunken focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:bg-line disabled:cursor-default disabled:border-transparent disabled:bg-transparent disabled:font-medium disabled:text-muted-text"
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
  scheduleById,
  personaPhotoById,
  selectedKey,
  todayKey,
  onSelect,
  onMonthChange,
  onMonthNavigate,
}: CalendarViewProps) {
  const { t, locale } = useI18n();
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(INTL_TAG[locale], { dateStyle: 'full' }), [locale]);
  // Weekday headers from Intl, not react-day-picker's date-fns names: the
  // pt-BR ones keep their accent ("sáb", not "sab"). Intl's short pt-BR
  // names end in a period ("sáb."), dropped for the column header.
  const formatters = useMemo(() => {
    const weekdayFormat = new Intl.DateTimeFormat(INTL_TAG[locale], { weekday: 'short' });
    return { formatWeekdayName: (date: Date) => weekdayFormat.format(date).replace(/\.$/, '') };
  }, [locale]);

  const personasByDay = useMemo(() => {
    const personas = new Map<string, PersonaPhoto[]>();
    for (const [key, slots] of slotsByDay) {
      const list = dayPersonas(slots, scheduleById, personaPhotoById, MAX_CELL_PERSONAS);
      if (list.length > 0) personas.set(key, list);
    }
    return personas;
  }, [slotsByDay, scheduleById, personaPhotoById]);

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
  // and select today. Nothing to do (disabled) when both already hold.
  const goToday = useCallback(() => {
    const now = dateFromKey(todayKey);
    onMonthChange(now.getFullYear(), now.getMonth());
    onSelect(todayKey);
  }, [todayKey, onMonthChange, onSelect]);
  const onToday = selectedKey === todayKey && todayKey.startsWith(`${monthKey(year, month)}-`);
  const navToday = useMemo(() => ({ goToday, onToday }), [goToday, onToday]);
  const dayCells = useMemo(() => ({ slotsByDay, personasByDay }), [slotsByDay, personasByDay]);

  return (
    <div className="rounded-xl border border-line bg-card p-2 sm:p-4">
      <DayCellContext.Provider value={dayCells}>
        <NavTodayContext.Provider value={navToday}>
          <Calendar
            mode="single"
            required
            locale={DAY_PICKER_LOCALE[locale]}
            weekStartsOn={firstWeekday}
            month={new Date(year, month, 1)}
            onMonthChange={(date) => onMonthChange(date.getFullYear(), date.getMonth())}
            onNextClick={(date) => onMonthNavigate(date.getFullYear(), date.getMonth())}
            onPrevClick={(date) => onMonthNavigate(date.getFullYear(), date.getMonth())}
            today={dateFromKey(todayKey)}
            selected={selectedKey === null ? undefined : dateFromKey(selectedKey)}
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
              weekdays: 'flex gap-0.5',
              weekday: 'flex-1 select-none text-xs font-medium text-muted-foreground',
              week: 'mt-1 flex w-full gap-0.5',
              // Today is drawn by the day number itself (see PostsDayButton):
              // drop shadcn's accent fill so today never reads as selected.
              today: 'rounded-md',
              // Rectangular cells (shadcn's are square), so the month stays short.
              day: 'group/day relative h-full w-full select-none p-0 text-center',
            }}
            components={{ DayButton: PostsDayButton, Nav: CalendarNav }}
          />
        </NavTodayContext.Provider>
      </DayCellContext.Provider>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-text">
        {CALENDAR_GROUP_ORDER.map((group) => (
          <li key={group} className="flex items-center gap-1.5">
            <StatusMarker group={group} />
            {t(CALENDAR_GROUP_KEY[group])}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span aria-hidden className={cn('size-4 rounded-full', TODAY_MARK_CLASS)} />
          {t('posts.calendarToday')}
        </li>
      </ul>
    </div>
  );
}
