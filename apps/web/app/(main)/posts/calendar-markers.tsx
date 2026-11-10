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
  'inline-flex h-6 min-w-6 max-xl:h-[1.625rem] max-xl:min-w-[1.625rem] items-center justify-center rounded-full border border-primary/55 bg-primary/22 px-1.5 text-xs font-bold leading-none text-primary tabular-nums shadow-[0_1px_0_rgba(13,43,69,0.14)]';

// Legend count sample: empty day-total dot (phone matches selected swatch scale).
export const LEGEND_POST_TOTAL_SWATCH_CLASS = cn(
  'pointer-events-none box-border inline-flex shrink-0 items-center justify-center rounded-full border border-primary/55 bg-primary/22 px-0 shadow-[0_1px_0_rgba(13,43,69,0.14)]',
  'h-4 min-h-4 w-4 min-w-4 max-w-4 max-xl:h-4 max-xl:min-h-4 max-xl:w-4 max-xl:min-w-4 max-xl:max-w-4',
  'xl:h-6 xl:min-h-6 xl:w-6 xl:min-w-6 xl:max-w-6',
);

export const TODAY_TOP_BAR_CLASS = 'h-1 w-full shrink-0 rounded-full bg-warning';

// Directly under the today numeral — underlines the date, not the row above.
export const TODAY_CELL_BAR_CLASS =
  'pointer-events-none mt-0.5 h-1.5 w-10 max-w-[calc(100%-0.25rem)] shrink-0 rounded-full bg-warning';

// Legend today: the same gold top bar as the grid — not a miniature scene.
export const LEGEND_TODAY_BAR_SWATCH_CLASS =
  'inline-block h-1 w-4 max-xl:w-4 shrink-0 rounded-full bg-warning align-middle xl:w-10';

// Fixed square frame so the ring never grows with the cell stack (outline-offset was
// collapsing the digit). Legend uses the same empty box — not a tall faux cell.
export const SELECTED_DAY_NUMERAL_OUTLINE_CLASS =
  'box-border inline-flex size-7 min-h-7 min-w-7 shrink-0 items-center justify-center overflow-visible rounded-md bg-transparent p-0 outline outline-2 outline-offset-0 outline-ring';

export const SELECTED_DAY_LEGEND_SWATCH_CLASS = cn(
  'pointer-events-none inline-block size-4 max-xl:size-4 shrink-0 rounded-md outline outline-2 outline-offset-0 outline-ring xl:size-7',
);

function DayCellPostTotal({
  total,
  groups,
  counts,
}: {
  total: number;
  groups: CalendarGroup[];
  counts: Record<CalendarGroup, number>;
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
      )}
    >
      {total}
    </span>
  );
}

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
// the cell (the list below names them). Today is a gold bar under the
// numeral, then the count pill. Selection outlines only the numeral;
// the count pill stays below it like unselected days.
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
        'relative aspect-auto h-[4.5rem] w-full max-w-full min-w-0 flex-col items-center justify-start px-0.5 pb-1 max-xl:min-h-[5.25rem] max-xl:h-[5.25rem] sm:h-24 sm:min-h-24 sm:pb-1 sm:pt-1 xl:h-[4.25rem] xl:min-h-[4.25rem] xl:gap-0.5 xl:pb-0.5',
        isToday ? 'gap-0 overflow-hidden pt-1' : 'gap-0.5 overflow-visible pt-0.5',
        slots.length > 0 && (isToday ? 'max-xl:gap-1.5' : 'max-xl:gap-2'),
        !isOutside && '[&>span]:opacity-100',
        isOutside &&
          'text-muted-foreground hover:bg-transparent hover:text-muted-foreground active:bg-transparent data-[selected-single=true]:text-muted-foreground',
        !isOutside && 'hover:bg-sunken hover:text-primary',
        'data-[selected-single=true]:bg-transparent data-[selected-single=true]:hover:bg-transparent',
        !isOutside && 'data-[selected-single=true]:text-primary',
        // shadcn Button paints a focus ring on the whole cell — nested under the numeral ring.
        'border-0 shadow-none outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
        'group-data-[focused=true]/day:bg-transparent group-data-[focused=true]/day:ring-0 group-data-[focused=true]/day:shadow-none',
        'group-data-[focused=true]/day:[&_[data-day-numeral]]:outline group-data-[focused=true]/day:[&_[data-day-numeral]]:outline-2 group-data-[focused=true]/day:[&_[data-day-numeral]]:outline-offset-0 group-data-[focused=true]/day:[&_[data-day-numeral]]:outline-ring',
        className,
      )}
      {...props}
    >
      <span
        data-day-number
        className={cn(
          'z-[2] flex w-full min-w-0 shrink-0 flex-col items-center gap-1 px-0.5 tabular-nums',
          isToday ? 'justify-center pt-0.5' : 'justify-start pt-2 sm:pt-2.5',
          isToday && slots.length > 0 && 'gap-1',
        )}
      >
        <span
          data-day-numeral
          className={cn(
            'inline-flex shrink-0 items-center justify-center text-base leading-none',
            isOutside ? 'font-normal text-muted-foreground opacity-50' : 'font-semibold text-primary',
            isToday && isOutside && 'opacity-100',
            selectedSingle && !isOutside && SELECTED_DAY_NUMERAL_OUTLINE_CLASS,
            !(selectedSingle && !isOutside) && 'min-h-6',
          )}
        >
          {children}
        </span>
        {isToday && <span aria-hidden data-today-bar="true" className={TODAY_CELL_BAR_CLASS} />}
      </span>
      {slots.length > 0 && (
        <span aria-hidden className="flex shrink-0 items-center justify-center">
          <DayCellPostTotal total={slots.length} groups={groups} counts={counts} />
        </span>
      )}
    </Button>
  );
}
