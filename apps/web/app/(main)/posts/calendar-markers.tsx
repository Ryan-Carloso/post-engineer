'use client';

import { createContext, useContext, type ComponentProps } from 'react';
import type { DayButton } from 'react-day-picker';
import type { ScheduledSlot } from '@/lib/api';
import { CalendarDayButton } from '@/components/ui/calendar';
import PersonaAvatar from '@/components/persona-avatar';
import { useI18n } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import { calendarCounts, dayKey, type PersonaPhoto } from './calendar-days';
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
      {labeled && <span className="hidden min-w-0 truncate sm:inline-flex">{label}</span>}
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
// slots and personas reach it through context so a data refresh never
// remounts the grid (which would drop keyboard focus).
type DaySlot = Pick<ScheduledSlot, 'status' | 'scheduleId' | 'slotAt'>;

interface DayContextValue {
  slotsByDay: Map<string, DaySlot[]>;
  personasByDay: Map<string, PersonaPhoto[]>;
}

export const DayCellContext = createContext<DayContextValue>({ slotsByDay: new Map(), personasByDay: new Map() });

// A day cell shows at most this many persona photos, then the hidden names.
const MAX_CELL_PERSONAS = 2;

//---------------
// PostsDayButton — one day cell. Fixed height whatever it holds, so rows
// never jump. The day number is centred under the weekday. Under it, the
// same persona row on every screen (two photos, then the hidden names, not
// a bare "+N"), then one nowrap chip row. A single group spells its word
// from the sm breakpoint up; a phone cell only has room for the icon and
// the count (the title and the day's name still say which group). Several
// groups stay icon and count so the words cannot clip into the next day.
// Today is an amber disc on the number. Selection is
// only a navy outline — a failed day is not painted red, and a selected
// empty day is not a filled block. Days outside the shown month dim the
// number only. The accessible name carries the per-group counts, so the
// markers and photos are aria-hidden.
//---------------
export function PostsDayButton({ children, ...props }: ComponentProps<typeof DayButton>) {
  const { slotsByDay, personasByDay } = useContext(DayCellContext);
  const key = dayKey(props.day.date);
  const slots = slotsByDay.get(key) ?? [];
  const personas = personasByDay.get(key) ?? [];
  const hiddenPersonas = personas.slice(MAX_CELL_PERSONAS);
  const counts = calendarCounts(slots);
  const groups = CALENDAR_GROUP_ORDER.filter((group) => counts[group] > 0);
  // One group has room for its word. Several groups stay icon and count,
  // or the words clip mid-letter into the next day. The title still names
  // each group, and the day's accessible name lists them.
  const labeled = groups.length === 1;
  const { today: isToday, outside: isOutside } = props.modifiers;
  return (
    <CalendarDayButton
      {...props}
      className={cn(
        'aspect-auto h-20 w-full max-w-full min-w-0 flex-col items-center justify-start gap-0.5 overflow-hidden px-0.5 pt-1 sm:h-24 [&>span]:text-sm [&>span]:opacity-100',
        // shadcn's ghost hover and single-selection are a solid navy fill.
        // A hovered cell only tints. Selection is an outline on a clear
        // cell, so it never looks like today, a status, or an avatar.
        'hover:bg-sunken hover:text-primary',
        'data-[selected-single=true]:bg-transparent data-[selected-single=true]:text-primary data-[selected-single=true]:outline-2 data-[selected-single=true]:-outline-offset-2 data-[selected-single=true]:outline-primary data-[selected-single=true]:hover:bg-transparent',
        // The outline is the selection; keyboard focus keeps its own ring,
        // and a mouse click adds no second ring on top of the outline.
        'group-data-[focused=true]/day:ring-0 group-data-[focused=true]/day:focus-visible:ring-[3px]',
        // shadcn's Button sizes every icon inside it to 16px; the marker
        // icons stay small so the chip row fits in the cell.
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
      {personas.length > 0 && (
        <span aria-hidden data-personas={personas.length} className="flex w-full min-w-0 items-center justify-center gap-0.5 overflow-hidden">
          {personas.slice(0, MAX_CELL_PERSONAS).map((persona, index) => (
            <PersonaAvatar key={`${index}-${persona.name}`} {...persona} size={16} className="[&_img]:grayscale" />
          ))}
          {hiddenPersonas.length > 0 && (
            <span
              data-personas-more
              title={hiddenPersonas.map((persona) => persona.name).join(', ')}
              className="min-w-0 truncate text-[10px] font-semibold text-ink-soft"
            >
              + {hiddenPersonas.map((persona) => persona.name).join(', ')}
            </span>
          )}
        </span>
      )}
      {slots.length > 0 && (
        <span aria-hidden className="flex w-full min-w-0 flex-nowrap items-center justify-start gap-0.5 overflow-hidden">
          {groups.map((group) => (
            <StatusMarker key={group} group={group} count={counts[group]} labeled={labeled} />
          ))}
        </span>
      )}
    </CalendarDayButton>
  );
}
