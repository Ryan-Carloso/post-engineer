'use client';

import { createContext, useContext, useEffect, useRef, type ComponentProps } from 'react';
import type { DayButton } from 'react-day-picker';
import type { ScheduledSlot } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import { calendarCounts, dayKey } from './calendar-days';
import {
  CALENDAR_GROUP_ICON,
  CALENDAR_GROUP_KEY,
  CALENDAR_GROUP_MARKER,
  CALENDAR_GROUP_ORDER,
  type CalendarGroup,
} from './status';

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
        'inline-flex h-4 max-xl:h-5 items-center justify-center gap-0.5 overflow-hidden rounded-full text-[10px] max-xl:text-[11px] leading-none font-bold',
        CALENDAR_GROUP_MARKER[group],
        labeled || showCount ? 'max-w-full min-w-0 shrink px-1 max-xl:px-1.5' : 'w-4 max-xl:w-5 shrink-0',
      )}
    >
      <Icon className="size-2.5 max-xl:size-3 shrink-0" strokeWidth={3} aria-hidden />
      {labeled && <span className="min-w-0 truncate">{label}</span>}
      {showCount && (
        <span data-count className="shrink-0 tabular-nums">
          {count}
        </span>
      )}
    </span>
  );
}

export const DAY_POST_TOTAL_CLASS =
  'inline-flex h-5 min-w-5 max-xl:h-6 max-xl:min-w-6 items-center justify-center rounded-full border border-line bg-card text-xs max-xl:text-sm font-bold leading-none text-primary tabular-nums shadow-[0_1px_0_rgba(13,43,69,0.06)]';

export const SELECTED_DAY_LEGEND_CLASS =
  'inline-flex size-6 shrink-0 items-center justify-center rounded-md outline-2 -outline-offset-2 outline-primary bg-transparent';

function DayCellPostTotal({
  total,
  groups,
  counts,
  selected = false,
}: {
  total: number;
  groups: CalendarGroup[];
  counts: Record<CalendarGroup, number>;
  selected?: boolean;
}) {
  const { t } = useI18n();
  const breakdown = groups.map((group) => `${t(CALENDAR_GROUP_KEY[group])}: ${counts[group]}`).join(', ');
  return (
    <span
      data-day-post-total
      title={breakdown}
      className={cn(
        DAY_POST_TOTAL_CLASS,
        'max-xl:px-2 px-1.5',
        selected && 'border-primary/25 bg-card',
      )}
    >
      {total}
    </span>
  );
}

// Today: gold numeral + thin ring — not a filled disc that reads as selection.
export const TODAY_CELL_CLASS = 'font-bold text-warning ring-2 ring-warning bg-transparent';

// Legend swatch beside the Today word (same ring, no fill).
export const TODAY_LEGEND_CLASS = 'size-4 rounded-full ring-2 ring-warning bg-transparent';

// The DayButton component is passed to react-day-picker once; the per-day
// slots reach it through context so a data refresh never remounts the grid.
type DaySlot = Pick<ScheduledSlot, 'status' | 'scheduleId' | 'slotAt'>;

interface DayContextValue {
  slotsByDay: Map<string, DaySlot[]>;
}

export const DayCellContext = createContext<DayContextValue>({ slotsByDay: new Map() });

//---------------
// PostsDayButton — one day cell. One post total (per-status breakdown is
// only in the accessible name and on the day's cards). No persona names in
// the cell (the list below names them). Today is an amber disc on the
// number only (gold ring). Selection is a navy outline on an overflow-visible cell so
// the ring does not clip the markers.
//---------------
export function PostsDayButton({ children, day, modifiers, className, ...props }: ComponentProps<typeof DayButton>) {
  const { slotsByDay } = useContext(DayCellContext);
  const key = dayKey(day.date);
  const slots = slotsByDay.get(key) ?? [];
  const counts = calendarCounts(slots);
  const groups = CALENDAR_GROUP_ORDER.filter((group) => counts[group] > 0);
  const { today: isToday, outside: isOutside } = modifiers;
  const selectedSingle =
    modifiers.selected && !modifiers.range_start && !modifiers.range_end && !modifiers.range_middle;
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString()}
      data-selected-single={selectedSingle ? true : undefined}
      data-day-button
      className={cn(
        'aspect-auto h-[4.5rem] w-full max-w-full min-w-0 flex-col items-center justify-start gap-0.5 overflow-visible px-0.5 pb-1 pt-0.5 max-xl:h-[4.75rem] sm:h-24 sm:min-h-24 sm:gap-1 sm:pb-1 sm:pt-1',
        !isOutside && '[&>span]:opacity-100',
        isOutside &&
          'text-muted-foreground hover:bg-transparent hover:text-muted-foreground active:bg-transparent data-[selected-single=true]:text-muted-foreground',
        !isOutside && 'hover:bg-sunken hover:text-primary',
        'data-[selected-single=true]:rounded-md data-[selected-single=true]:bg-transparent data-[selected-single=true]:outline-2 data-[selected-single=true]:-outline-offset-[4px] data-[selected-single=true]:outline-primary data-[selected-single=true]:hover:bg-transparent data-[selected-single=true]:pb-1.5',
        !isOutside && 'data-[selected-single=true]:text-primary',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'group-data-[focused=true]/day:bg-transparent group-data-[focused=true]/day:ring-0 group-data-[focused=true]/day:shadow-none',
        className,
      )}
      {...props}
    >
      <span
        data-day-number
        data-today-mark={isToday ? 'true' : undefined}
        className={cn(
          'inline-flex size-6 shrink-0 items-center justify-center rounded-full tabular-nums',
          isOutside ? 'font-normal text-muted-foreground opacity-50' : 'font-semibold text-primary',
          isToday && TODAY_CELL_CLASS,
          isToday && isOutside && 'opacity-100',
        )}
      >
        {children}
      </span>
      {slots.length > 0 && (
        <span aria-hidden className="flex w-full min-w-0 items-center justify-center overflow-visible px-0.5 pt-0.5">
          <DayCellPostTotal total={slots.length} groups={groups} counts={counts} selected={selectedSingle} />
        </span>
      )}
    </Button>
  );
}
