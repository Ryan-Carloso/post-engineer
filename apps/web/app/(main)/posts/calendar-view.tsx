'use client';

import { createContext, useCallback, useContext, useMemo, type ComponentProps, type MouseEventHandler } from 'react';
import { UI, useDayPicker, type DayButton, type NavProps } from 'react-day-picker';
import { enUS, ptBR } from 'react-day-picker/locale';
import type { ScheduleConfig, ScheduledSlot } from '@/lib/api';
import type { Locale } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { Calendar, CalendarDayButton } from '@/components/ui/calendar';
import PersonaAvatar from '@/components/persona-avatar';
import { cn } from '@/lib/utils';
import { INTL_TAG, calendarCounts, dateFromKey, dayKey, dayPhoto, type DayPhoto, type PersonaPhoto } from './calendar-days';
import { CALENDAR_GROUP_ICON, CALENDAR_GROUP_KEY, CALENDAR_GROUP_ORDER, CALENDAR_GROUP_STYLE } from './status';

// CalendarView — month calendar on the shadcn Calendar (react-day-picker:
// grid semantics, keyboard navigation, focus). Each day shows the most
// relevant post's persona photo (dayPhoto in calendar-days.ts): a green
// ring means published, a red ring failed, a split ring a mixed day
// (published + failed), no ring a day still to publish. A day with more
// than one post carries a count badge on the photo, so it never looks like
// a single-post day. Days with posts but no resolvable persona show a
// neutral count instead of a photo. Today is a thick border, never a fill,
// so it still reads as today when another day is selected. Day buckets use
// the viewer's browser timezone (calendar-days.ts). Data and the selected
// day's posts live in the page.

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

// The DayButton component is passed to react-day-picker once; the per-day
// slots and photos reach it through context so a data refresh never remounts
// the grid (which would drop keyboard focus).
interface DayContextValue {
  slotsByDay: Map<string, Pick<ScheduledSlot, 'status' | 'scheduleId' | 'slotAt'>[]>;
  photoByDay: Map<string, DayPhoto>;
}

const SlotsContext = createContext<DayContextValue>({ slotsByDay: new Map(), photoByDay: new Map() });

// The Today action lives inside the month navigation (prev / Today / next),
// so the nav component needs it from context: passing a closure component
// to react-day-picker would remount the nav on every render and drop
// keyboard focus.
const NavTodayContext = createContext<() => void>(() => {});

// The month navigation: previous month, Today, next month. Mirrors
// react-day-picker's default Nav (same buttons, labels and disabled
// behaviour) with the Today action between the arrows, so Today sits next
// to the month navigation instead of in the legend row below the calendar.
function CalendarNav({ onPreviousClick, onNextClick, previousMonth, nextMonth, ...navProps }: NavProps) {
  const { components, classNames, styles, labels } = useDayPicker();
  const { t } = useI18n();
  const goToday = useContext(NavTodayContext);
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
      <Button type="button" variant="outline" size="sm" onClick={goToday}>
        {t('posts.calendarToday')}
      </Button>
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

// The day's persona photo. The status ring is a BORDER, not a box-shadow
// ring: Tailwind v4's ring width sets its shadow through
// `var(--tw-ring-inset,)` — an empty var() fallback this repo's Cypress
// Electron drops at parse time, so a ring would be invisible there. A
// border renders everywhere. The avatar's own ring is suppressed (ring-0)
// so only the status border shows. A mixed day (published + failed) splits
// the ring in two with a conic-gradient wrapper, because a border color
// cannot be two colors at once.
function DayPhotoBadge({ photo }: { photo: DayPhoto }) {
  if (photo.mixed) {
    return (
      <span
        data-ring={photo.ring}
        data-mixed="true"
        aria-hidden
        className="rounded-full bg-[conic-gradient(var(--color-success)_0turn_0.5turn,var(--color-destructive)_0.5turn_1turn)] p-[2px]"
      >
        <PersonaAvatar {...photo.persona} size={32} className="ring-0" />
      </span>
    );
  }
  const borderClass =
    photo.ring === 'published' ? 'border-2 border-success' : photo.ring === 'failed' ? 'border-2 border-destructive' : '';
  return (
    <span data-ring={photo.ring} data-mixed="false" aria-hidden className={cn('rounded-full', borderClass)}>
      <PersonaAvatar {...photo.persona} size={32} className={borderClass === '' ? undefined : 'ring-0'} />
    </span>
  );
}

function PostsDayButton({ children, ...props }: ComponentProps<typeof DayButton>) {
  const { slotsByDay, photoByDay } = useContext(SlotsContext);
  const slots = slotsByDay.get(dayKey(props.day.date)) ?? [];
  const photo = photoByDay.get(dayKey(props.day.date)) ?? null;
  // Today is a thick border, never a fill: it must still read as today when
  // another day is selected. When today itself is selected the border
  // cannot be the card color — the border sits on the card behind the
  // button, so a card-colored frame vanishes against it — nor the primary
  // color, which matches the selected fill. The ring token contrasts with
  // both the selected fill and the card in both themes, so today stays
  // readable while selected. A border, not a box-shadow ring — see
  // DayPhotoBadge for why.
  const isToday = props.modifiers.today;
  const isSelected = props.modifiers.selected;
  return (
    <CalendarDayButton
      {...props}
      className={cn(
        'aspect-auto h-auto min-h-11 justify-start gap-1 py-1 sm:min-h-14 [&>span]:opacity-100',
        isToday && (isSelected ? 'border-2 border-ring' : 'border-2 border-primary'),
      )}
    >
      <span className="text-sm font-semibold tabular-nums">{children}</span>
      {slots.length > 0 &&
        (photo === null ? (
          <span
            data-photo="none"
            data-count={slots.length}
            aria-hidden
            className="inline-flex size-8 items-center justify-center rounded-full bg-sunken text-xs font-bold text-muted-text"
          >
            {slots.length}
          </span>
        ) : (
          // A multi-post day shows its count on the photo: one photo alone
          // reads as one post. The accessible name already carries the
          // per-group counts, so the badge is aria-hidden.
          <span className="relative inline-flex">
            <DayPhotoBadge photo={photo} />
            {slots.length > 1 && (
              <span
                data-count={slots.length}
                aria-hidden
                className="absolute -right-1.5 -bottom-1.5 flex size-5 items-center justify-center rounded-full border border-line bg-card text-[10px] font-bold text-primary"
              >
                {slots.length}
              </span>
            )}
          </span>
        ))}
    </CalendarDayButton>
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

  const photoByDay = useMemo(() => {
    const photos = new Map<string, DayPhoto>();
    for (const [key, slots] of slotsByDay) {
      const photo = dayPhoto(slots, scheduleById, personaPhotoById);
      if (photo !== null) photos.set(key, photo);
    }
    return photos;
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
  // and select today.
  const goToday = useCallback(() => {
    const now = dateFromKey(todayKey);
    onMonthChange(now.getFullYear(), now.getMonth());
    onSelect(todayKey);
  }, [todayKey, onMonthChange, onSelect]);

  return (
    <div className="rounded-xl border border-line bg-card p-2 sm:p-4">
      <SlotsContext.Provider value={{ slotsByDay, photoByDay }}>
        <NavTodayContext.Provider value={goToday}>
          <Calendar
            mode="single"
            required
            locale={DAY_PICKER_LOCALE[locale]}
            weekStartsOn={firstWeekday}
            fixedWeeks
            month={new Date(year, month, 1)}
            onMonthChange={(date) => onMonthChange(date.getFullYear(), date.getMonth())}
            onNextClick={(date) => onMonthNavigate(date.getFullYear(), date.getMonth())}
            onPrevClick={(date) => onMonthNavigate(date.getFullYear(), date.getMonth())}
            today={dateFromKey(todayKey)}
            selected={selectedKey === null ? undefined : dateFromKey(selectedKey)}
            onSelect={(date) => onSelect(dayKey(date))}
            labels={labels}
            className="w-full bg-transparent p-0 [--cell-size:--spacing(10)]"
            classNames={{
              root: 'w-full',
              caption_label: 'text-base font-bold capitalize text-primary',
              // The nav clusters right (prev / Today / next) and the caption
              // title left-aligns with room to its right, so the title
              // never runs under the navigation.
              nav: 'absolute right-0 top-0 flex items-center gap-1',
              month_caption: 'flex min-h-(--cell-size) w-full items-center justify-start pr-44',
              // Tighter week gap: empty cells already shrank (see
              // PostsDayButton), the rows close up with them.
              week: 'mt-1 flex w-full',
              // Today is drawn by the day button itself (thick ring, see
              // PostsDayButton): drop shadcn's accent fill so today never
              // reads as selected.
              today: 'rounded-md',
              // Rectangular cells (shadcn's are square), so the 6-week month stays short.
              day: 'group/day relative h-full w-full select-none p-0 text-center',
            }}
            components={{ DayButton: PostsDayButton, Nav: CalendarNav }}
          />
        </NavTodayContext.Provider>
      </SlotsContext.Provider>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-text">
        {CALENDAR_GROUP_ORDER.map((group) => {
          const Icon = CALENDAR_GROUP_ICON[group];
          return (
            <li key={group} className="flex items-center gap-1.5">
              <span className={cn('inline-flex size-4 items-center justify-center rounded-full', CALENDAR_GROUP_STYLE[group])}>
                <Icon className="size-2.5" strokeWidth={3} aria-hidden />
              </span>
              {t(CALENDAR_GROUP_KEY[group])}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
