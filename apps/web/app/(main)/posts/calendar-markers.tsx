'use client';

import { createContext, useContext, type ComponentProps } from 'react';
import type { DayButton } from 'react-day-picker';
import type { ScheduledSlot } from '@/lib/api';
import { CalendarDayButton } from '@/components/ui/calendar';
import PersonaAvatar from '@/components/persona-avatar';
import { cn } from '@/lib/utils';
import { calendarCounts, dayKey, type PersonaPhoto } from './calendar-days';
import { CALENDAR_GROUP_ICON, CALENDAR_GROUP_MARKER, CALENDAR_GROUP_ORDER, type CalendarGroup } from './status';

//---------------
// The posts calendar's status vocabulary drawn as markers, and the day cell
// that carries them. One marker per status group (icon + color, so status
// never relies on color alone) is shared by the day cells, the legend and
// the day summary under the calendar, so the legend always matches what a
// cell shows. Extracted from calendar-view.tsx to keep it small.
//---------------

export function StatusMarker({
  group,
  count,
  countClassName,
}: {
  group: CalendarGroup;
  count?: number;
  // Lets a day cell hide the number on narrow screens (icon only).
  countClassName?: string;
}) {
  const Icon = CALENDAR_GROUP_ICON[group];
  return (
    <span
      data-marker={group}
      className={cn(
        'inline-flex h-4 min-w-4 shrink-0 items-center justify-center gap-0.5 rounded-full text-[10px] leading-none font-bold tabular-nums',
        CALENDAR_GROUP_MARKER[group],
        count !== undefined && (countClassName === undefined ? 'px-1' : 'sm:px-1'),
      )}
    >
      <Icon className="size-2.5 shrink-0" strokeWidth={3} aria-hidden />
      {count !== undefined && <span className={countClassName}>{count}</span>}
    </span>
  );
}

// The swatch marking today, shared by the day cell and the legend.
export const TODAY_MARK_CLASS = 'border-2 border-card bg-info text-on-ink';

// The DayButton component is passed to react-day-picker once; the per-day
// slots and personas reach it through context so a data refresh never
// remounts the grid (which would drop keyboard focus).
type DaySlot = Pick<ScheduledSlot, 'status' | 'scheduleId' | 'slotAt'>;

interface DayContextValue {
  slotsByDay: Map<string, DaySlot[]>;
  personasByDay: Map<string, PersonaPhoto[]>;
}

export const DayCellContext = createContext<DayContextValue>({ slotsByDay: new Map(), personasByDay: new Map() });

//---------------
// PostsDayButton — one day cell. Fixed height whatever it holds, so rows
// never jump. Top to bottom: the day number (today is a filled blue disc,
// so it never reads as the selection, which fills the whole cell), the
// day's personas (wide screens only), then one status marker per group,
// failure first — a day with a failed post is also tinted red, so it is
// recognisable before it is opened. Days outside the shown month are
// dimmed. The accessible name carries the per-group counts, so the
// markers and photos are aria-hidden.
//---------------
export function PostsDayButton({ children, ...props }: ComponentProps<typeof DayButton>) {
  const { slotsByDay, personasByDay } = useContext(DayCellContext);
  const key = dayKey(props.day.date);
  const slots = slotsByDay.get(key) ?? [];
  const personas = personasByDay.get(key) ?? [];
  const counts = calendarCounts(slots);
  const { today: isToday, selected: isSelected, outside: isOutside } = props.modifiers;
  return (
    <CalendarDayButton
      {...props}
      className={cn(
        'aspect-auto h-14 justify-start gap-1 pt-1.5 sm:h-20 [&>span]:text-sm',
        isOutside ? '[&>span]:opacity-45' : '[&>span]:opacity-100',
        // shadcn's ghost hover is the navy accent fill, which reads as a
        // second selection: hovering only tints the cell.
        'hover:bg-sunken hover:text-primary data-[selected-single=true]:hover:bg-primary data-[selected-single=true]:hover:text-primary-foreground',
        counts.failed > 0 && !isSelected && 'bg-destructive-soft',
      )}
    >
      <span
        data-day-number
        data-today-mark={isToday ? 'true' : undefined}
        className={cn(
          'inline-flex size-6 shrink-0 items-center justify-center rounded-full tabular-nums',
          isOutside ? 'font-normal' : 'font-semibold',
          isToday && TODAY_MARK_CLASS,
        )}
      >
        {children}
      </span>
      {personas.length > 0 && (
        <span aria-hidden data-personas={personas.length} className="hidden -space-x-1.5 sm:flex">
          {personas.map((persona, index) => (
            <PersonaAvatar key={`${index}-${persona.name}`} {...persona} size={22} className="ring-2 ring-card" />
          ))}
        </span>
      )}
      {slots.length > 0 && (
        <span aria-hidden className="flex flex-wrap justify-center gap-0.5 sm:gap-1">
          {CALENDAR_GROUP_ORDER.filter((group) => counts[group] > 0).map((group) => (
            <StatusMarker key={group} group={group} count={counts[group]} countClassName="hidden sm:inline" />
          ))}
        </span>
      )}
    </CalendarDayButton>
  );
}
