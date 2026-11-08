'use client';

import { createContext, useCallback, useContext, useMemo, type ComponentProps } from 'react';
import type { DayButton } from 'react-day-picker';
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
// (published + failed), no ring a day still to publish. Days with posts but
// no resolvable persona show a neutral count instead of a photo. Today is a
// thick border, never a fill, so it still reads as today when another day
// is selected. Day buckets use the viewer's browser timezone
// (calendar-days.ts). Data and the selected day's posts live in the page.

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
  // another day is selected, and when today itself is selected the border
  // switches to the card color so it stays visible against the selected
  // fill (a primary border on a primary fill would disappear). A border,
  // not a box-shadow ring — see DayPhotoBadge for why.
  const isToday = props.modifiers.today;
  const isSelected = props.modifiers.selected;
  return (
    <CalendarDayButton
      {...props}
      className={cn(
        'aspect-auto h-auto min-h-12 justify-start gap-1 py-1.5 sm:min-h-16 [&>span]:opacity-100',
        isToday && (isSelected ? 'border-2 border-card' : 'border-2 border-primary'),
      )}
    >
      <span className="text-sm font-semibold tabular-nums">{children}</span>
      {slots.length > 0 &&
        (photo === null ? (
          <span
            data-photo="none"
            aria-hidden
            className="inline-flex size-8 items-center justify-center rounded-full bg-sunken text-xs font-bold text-muted-text"
          >
            {slots.length}
          </span>
        ) : (
          <DayPhotoBadge photo={photo} />
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

  return (
    <div className="rounded-xl border border-line bg-card p-2 sm:p-4">
      <SlotsContext.Provider value={{ slotsByDay, photoByDay }}>
        <Calendar
          mode="single"
          required
          locale={DAY_PICKER_LOCALE[locale]}
          weekStartsOn={firstWeekday}
          fixedWeeks
          month={new Date(year, month, 1)}
          onMonthChange={(date) => onMonthChange(date.getFullYear(), date.getMonth())}
          today={dateFromKey(todayKey)}
          selected={selectedKey === null ? undefined : dateFromKey(selectedKey)}
          onSelect={(date) => onSelect(dayKey(date))}
          labels={labels}
          className="w-full bg-transparent p-0 [--cell-size:--spacing(10)]"
          classNames={{
            root: 'w-full',
            caption_label: 'text-base font-bold capitalize text-primary',
            // Today is drawn by the day button itself (thick ring, see
            // PostsDayButton): drop shadcn's accent fill so today never
            // reads as selected.
            today: 'rounded-md',
            // Rectangular cells (shadcn's are square), so the 6-week month stays short.
            day: 'group/day relative h-full w-full select-none p-0 text-center',
          }}
          components={{ DayButton: PostsDayButton }}
        />
      </SlotsContext.Provider>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-text">
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const now = dateFromKey(todayKey);
            onMonthChange(now.getFullYear(), now.getMonth());
            onSelect(todayKey);
          }}
        >
          {t('posts.calendarToday')}
        </Button>
      </div>
    </div>
  );
}
