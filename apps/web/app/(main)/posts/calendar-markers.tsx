'use client';

import { createContext, useContext, type ComponentProps } from 'react';
import type { DayButton } from 'react-day-picker';
import type { ScheduledSlot } from '@/lib/api';
import { CalendarDayButton } from '@/components/ui/calendar';
import { useI18n } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import { calendarCounts, dayKey } from './calendar-days';
import { CALENDAR_GROUP_ICON, CALENDAR_GROUP_KEY, CALENDAR_GROUP_MARKER, CALENDAR_GROUP_ORDER, type CalendarGroup } from './status';

//---------------
// The posts calendar's status vocabulary drawn as markers, and the day cell
// that carries them. One marker per status group (icon + color, so status
// never relies on color alone) is shared by the day cells, the legend and
// the day summary under the calendar, so the legend always matches what a
// cell shows. Extracted from calendar-view.tsx to keep it small.
//---------------

// `labeled` draws the group word inside the chip (a day cell). The legend
// and the day summary keep the icon and put the word beside it.
export function StatusMarker({ group, count, labeled = false }: { group: CalendarGroup; count?: number; labeled?: boolean }) {
  const { t } = useI18n();
  const Icon = CALENDAR_GROUP_ICON[group];
  const label = t(CALENDAR_GROUP_KEY[group]);
  const showCount = count !== undefined;
  return (
    <span
      data-marker={group}
      title={showCount ? `${label}: ${count}` : label}
      className={cn(
        'inline-flex h-[18px] items-center justify-center gap-0.5 overflow-hidden rounded-full text-[10px] leading-none font-bold',
        CALENDAR_GROUP_MARKER[group],
        labeled || showCount ? 'max-w-full min-w-0 shrink px-1' : 'w-[18px] shrink-0',
      )}
    >
      <Icon className="size-2.5 shrink-0" strokeWidth={3} aria-hidden />
      {labeled && <span className="min-w-0 truncate">{label}</span>}
      {showCount && (
        <span data-count className="shrink-0 tabular-nums">
          {count}
        </span>
      )}
    </span>
  );
}

// Today, on the day number. Amber, so it is neither the navy selection
// outline nor a status or avatar color, and it stays when another day is
// selected. `text-on-ink` flips with the theme.
export const TODAY_MARK_CLASS = 'bg-warning text-on-ink';

// The DayButton component is passed to react-day-picker once; the per-day
// slots reach it through context so a data refresh never remounts the grid.
type DaySlot = Pick<ScheduledSlot, 'status' | 'scheduleId' | 'slotAt'>;

interface DayContextValue {
  slotsByDay: Map<string, DaySlot[]>;
}

export const DayCellContext = createContext<DayContextValue>({ slotsByDay: new Map() });

const MAX_CELL_MARKERS = 2;

//---------------
// PostsDayButton — one day cell. Up to two status icons and an overflow
// count; no persona names or avatars in the cell (the list below names
// them). A single status group spells its word in a pill; several groups
// stay icon and count. Today is an amber disc on the number only.
// Selection is a navy outline on an overflow-visible cell so the ring
// does not clip the markers.
//---------------
export function PostsDayButton({ children, ...props }: ComponentProps<typeof DayButton>) {
  const { slotsByDay } = useContext(DayCellContext);
  const key = dayKey(props.day.date);
  const slots = slotsByDay.get(key) ?? [];
  const counts = calendarCounts(slots);
  const groups = CALENDAR_GROUP_ORDER.filter((group) => counts[group] > 0);
  const visibleGroups = groups.slice(0, MAX_CELL_MARKERS);
  const overflowCount = groups.slice(MAX_CELL_MARKERS).reduce((sum, group) => sum + counts[group], 0);
  const labeled = false;
  const { today: isToday, outside: isOutside } = props.modifiers;
  return (
    <CalendarDayButton
      {...props}
      data-day-button
      className={cn(
        'aspect-auto h-20 w-full max-w-full min-w-0 flex-col items-center justify-start gap-0.5 overflow-visible px-0.5 pt-1 sm:h-24 [&>span]:text-sm [&>span]:opacity-100',
        'hover:bg-sunken hover:text-primary',
        'data-[selected-single=true]:bg-transparent data-[selected-single=true]:text-primary data-[selected-single=true]:outline-2 data-[selected-single=true]:-outline-offset-2 data-[selected-single=true]:outline-primary data-[selected-single=true]:hover:bg-transparent',
        'group-data-[focused=true]/day:ring-0 group-data-[focused=true]/day:focus-visible:ring-[3px]',
        '[&_[data-marker]_svg]:size-2.5',
      )}
    >
      <span
        data-day-number
        data-today-mark={isToday ? 'true' : undefined}
        className={cn(
          'inline-flex size-6 shrink-0 items-center justify-center rounded-full tabular-nums',
          isOutside ? 'font-normal opacity-45' : 'font-semibold',
          isToday && TODAY_MARK_CLASS,
        )}
      >
        {children}
      </span>
      {slots.length > 0 && (
        <span aria-hidden className="flex w-full min-w-0 flex-nowrap items-center justify-center gap-0.5 overflow-hidden">
          {visibleGroups.map((group) => (
            <StatusMarker key={group} group={group} count={counts[group]} labeled={labeled} />
          ))}
          {overflowCount > 0 && (
            <span
              data-overflow-count
              className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-sunken px-1 text-[10px] font-bold text-ink-soft tabular-nums"
            >
              +{overflowCount}
            </span>
          )}
        </span>
      )}
    </CalendarDayButton>
  );
}
