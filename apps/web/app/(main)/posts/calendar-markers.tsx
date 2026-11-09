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

export function StatusMarker({ group, count }: { group: CalendarGroup; count?: number }) {
  const Icon = CALENDAR_GROUP_ICON[group];
  return (
    <span
      data-marker={group}
      className={cn(
        'inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full text-[11px] leading-none font-bold tabular-nums',
        CALENDAR_GROUP_MARKER[group],
        count !== undefined && 'px-0.5 sm:gap-0.5 sm:px-1.5',
      )}
    >
      <Icon className="size-2.5 shrink-0 sm:size-3" strokeWidth={3} aria-hidden />
      {count !== undefined && <span>{count}</span>}
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

// A day cell shows at most this many persona photos, then "+N".
const MAX_CELL_PERSONAS = 2;

//---------------
// PostsDayButton — one day cell. Fixed height whatever it holds, so rows
// never jump. On wide screens the day number and up to two persona photos
// (side by side, never overlapped, then "+N") share the top row; on a
// phone the cell is too narrow for photos and shows the number alone.
// Below them, one status marker per group with its count, failure first,
// in the same order on every screen size. Today is a filled blue disc on
// the number; the selected day keeps its own background (a failed day
// stays red) and gets a navy outline, so selection never hides what the
// day holds. A day with a failed post is tinted red. Days outside the
// shown month are dimmed. The accessible name carries the per-group
// counts, so the markers and photos are aria-hidden.
//---------------
export function PostsDayButton({ children, ...props }: ComponentProps<typeof DayButton>) {
  const { slotsByDay, personasByDay } = useContext(DayCellContext);
  const key = dayKey(props.day.date);
  const slots = slotsByDay.get(key) ?? [];
  const personas = personasByDay.get(key) ?? [];
  const extraPersonas = personas.length - MAX_CELL_PERSONAS;
  const counts = calendarCounts(slots);
  const { today: isToday, outside: isOutside } = props.modifiers;
  const hasFailure = counts.failed > 0;
  return (
    <CalendarDayButton
      {...props}
      className={cn(
        'aspect-auto h-18 justify-start gap-1 pt-1.5 sm:h-19 sm:items-stretch sm:px-1.5 [&>span]:text-sm',
        isOutside ? '[&>span]:opacity-45' : '[&>span]:opacity-100',
        // shadcn's ghost hover and selection are the solid navy accent
        // fill: a hovered cell only tints, and the selected cell keeps its
        // own background under a navy outline, so a selected failed day
        // stays red and a selected empty day is not a heavy navy block.
        'hover:bg-sunken hover:text-primary',
        'data-[selected-single=true]:text-primary data-[selected-single=true]:outline-2 data-[selected-single=true]:-outline-offset-2 data-[selected-single=true]:outline-primary',
        hasFailure
          ? 'bg-destructive-soft data-[selected-single=true]:bg-destructive-soft data-[selected-single=true]:hover:bg-destructive-soft'
          : 'data-[selected-single=true]:bg-info-soft data-[selected-single=true]:hover:bg-info-soft',
        // The outline is the selection; keyboard focus keeps its own ring,
        // and a mouse click adds no second ring on top of the outline.
        'group-data-[focused=true]/day:ring-0 group-data-[focused=true]/day:focus-visible:ring-[3px]',
        // shadcn's Button sizes every icon inside it to 16px; the marker
        // icons stay small so two markers fit side by side in a phone cell.
        '[&_[data-marker]_svg]:size-2.5 sm:[&_[data-marker]_svg]:size-3',
      )}
    >
      <span className="flex items-center justify-center gap-1 sm:justify-start sm:gap-1.5">
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
          <span aria-hidden data-personas={personas.length} className="hidden items-center gap-0.5 sm:flex">
            {personas.slice(0, MAX_CELL_PERSONAS).map((persona, index) => (
              <PersonaAvatar key={`${index}-${persona.name}`} {...persona} size={20} />
            ))}
            {extraPersonas > 0 && (
              <span data-personas-more className="text-[11px] font-semibold text-ink-soft tabular-nums">
                +{extraPersonas}
              </span>
            )}
          </span>
        )}
      </span>
      {slots.length > 0 && (
        <span aria-hidden className="flex flex-wrap justify-center gap-px sm:justify-start sm:gap-1">
          {CALENDAR_GROUP_ORDER.filter((group) => counts[group] > 0).map((group) => (
            <StatusMarker key={group} group={group} count={counts[group]} />
          ))}
        </span>
      )}
    </CalendarDayButton>
  );
}
