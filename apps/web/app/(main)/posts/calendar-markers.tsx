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
  'inline-flex h-5 min-w-5 max-xl:h-6 max-xl:min-w-6 items-center justify-center rounded-full border border-primary/40 bg-primary/12 text-xs max-xl:text-sm font-bold leading-none text-primary tabular-nums shadow-[0_1px_0_rgba(13,43,69,0.1)]';

// Legend count sample: empty day-total pill (same chrome as the grid badges).
export const LEGEND_POST_TOTAL_SWATCH_CLASS = cn(
  DAY_POST_TOTAL_CLASS,
  'pointer-events-none min-h-6 min-w-[1.625rem] px-2 shadow-none',
);

// Gold wash behind today's date numeral (not a count ring).
export const TODAY_NUMERAL_WASH_CLASS = 'rounded-sm bg-warning/30 px-0.5';

export const TODAY_TOP_BAR_CLASS = 'h-1 w-full shrink-0 rounded-full bg-warning';

export const TODAY_CELL_TOP_BAR_CLASS = 'absolute inset-x-1 top-0.5 z-[1] h-1 rounded-full bg-warning';

// Miniature selected day cell: blue outline like the grid, not a form checkbox.
export const SELECTED_DAY_LEGEND_SWATCH_CLASS =
  'pointer-events-none inline-flex h-9 w-8 shrink-0 items-center justify-center rounded-md bg-card outline-2 -outline-offset-2 outline-primary';

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
        selected && 'border-primary/50 bg-primary/15',
      )}
    >
      {total}
    </span>
  );
}

// In-cell dot: separate from the count pill and from the numeral wash.
export const TODAY_MARK_DOT_CLASS =
  'size-2.5 max-xl:size-3 shrink-0 rounded-full bg-warning ring-2 ring-warning/40';

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
// the cell (the list below names them). Today is a gold wash on the numeral
// plus a corner dot; counts stay in the bottom pill. Selection is a navy outline
// on an overflow-visible cell so the ring does not clip the markers.
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
        'aspect-auto h-[4.5rem] w-full max-w-full min-w-0 flex-col items-center justify-start gap-0.5 overflow-visible px-0.5 pb-1 pt-0.5 max-xl:h-[4.75rem] sm:h-24 sm:min-h-24 sm:gap-1 sm:pb-1 sm:pt-1 xl:h-[4.25rem] xl:min-h-[4.25rem] xl:gap-0.5 xl:pb-0.5 xl:pt-0.5',
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
      {isToday && (
        <span aria-hidden data-today-bar="true" className={TODAY_CELL_TOP_BAR_CLASS} />
      )}
      {isToday && (
        <span aria-hidden data-today-mark="true" className={cn(TODAY_MARK_DOT_CLASS, 'absolute left-1 top-2 z-[1]')} />
      )}
      <span
        data-day-number
        className={cn(
          'inline-flex min-h-6 shrink-0 items-center justify-center tabular-nums',
          isOutside ? 'font-normal text-muted-foreground opacity-50' : 'font-semibold text-primary',
          isToday && TODAY_NUMERAL_WASH_CLASS,
          isToday && isOutside && 'opacity-100',
        )}
      >
        <span className="leading-none">{children}</span>
      </span>
      {slots.length > 0 && (
        <span
          aria-hidden
          className="mt-auto flex w-full min-w-0 items-center justify-center overflow-visible px-0.5 pb-0.5 pt-0.5"
        >
          <DayCellPostTotal total={slots.length} groups={groups} counts={counts} selected={selectedSingle} />
        </span>
      )}
    </Button>
  );
}
