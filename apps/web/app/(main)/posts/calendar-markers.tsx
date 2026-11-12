'use client';

import { createContext, useContext, useEffect, useRef, type ComponentProps } from 'react';
import type { DayButton } from 'react-day-picker';
import type { ScheduledSlot } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import { calendarCounts, dayKey } from './calendar-days';
import {
  CALENDAR_GROUP_DOT,
  CALENDAR_GROUP_KEY,
  CALENDAR_GROUP_ORDER,
  calendarGroupOf,
} from './status';

//---------------
// The posts calendar's day cell: a row of post dots (one per post, coloured
// by its calendar group; the status breakdown is in the accessible name),
// the gold today numeral, and the filled selected-day chip — plus the
// legend swatches that sample the same marks so the legend always matches
// what a cell shows. Extracted from calendar-view.tsx to keep it small.
//---------------

// A dot is one post: the same dot fills for every network and every status,
// so a week of posts reads like a density strip instead of a wall of numbers.
export const DAY_POST_DOT_CLASS = 'size-1.5 shrink-0 rounded-full';
export const DAY_POST_DOTS_CLASS = 'flex items-center justify-center gap-1';

// Beyond this many posts the cell would need a second row and stop reading
// as a strip; the extra posts become a small "+N" and the day panel lists
// every one of them.
export const MAX_DAY_DOTS = 4;

// Legend sample: the same dots a cell shows, one per calendar group, so the
// legend teaches the colours.
export function LegendPostDotsSwatch() {
  return (
    <span aria-hidden data-legend-post-total className="pointer-events-none inline-flex shrink-0 items-center gap-0.5">
      {CALENDAR_GROUP_ORDER.map((group) => (
        <span
          key={group}
          data-post-dot
          data-group={group}
          className={cn(DAY_POST_DOT_CLASS, 'max-xl:size-1', CALENDAR_GROUP_DOT[group])}
        />
      ))}
    </span>
  );
}

// Today is the numeral's own colour. A bar under the digit sat in the same
// row as the post dots and read as another status.
export const TODAY_NUMERAL_CLASS = 'text-warning';

// Only when today is also the open day: a gold pip above the chip, never
// down with the posts. The chip already says "selected".
export const TODAY_PIP_CLASS = 'size-1.5 shrink-0 rounded-full bg-warning';

// Legend today: the same gold numeral the grid uses, not a bar.
export function LegendTodaySwatch() {
  return (
    <span
      aria-hidden
      data-legend-today
      className="pointer-events-none inline-flex size-7 max-xl:size-4 max-xl:min-h-4 max-xl:min-w-4 max-xl:text-[10px] shrink-0 items-center justify-center text-base font-semibold leading-none text-warning tabular-nums"
    >
      11
    </span>
  );
}

// Selected day: a filled brand square with rounded corners, on the numeral
// only. A circle read as another status dot, and a blue ring was the same
// hue as an in-progress post.
export const SELECTED_DAY_NUMERAL_CLASS =
  'box-border inline-flex size-7 min-h-7 min-w-7 shrink-0 items-center justify-center overflow-visible rounded-lg bg-brand p-0 text-white';

// Legend selected-day sample: the same filled chip as the grid numeral.
export function LegendSelectedDaySwatch() {
  return (
    <span
      aria-hidden
      data-legend-selected-day
      className={cn(
        SELECTED_DAY_NUMERAL_CLASS,
        'pointer-events-none font-semibold leading-none tabular-nums',
        'max-xl:size-4 max-xl:min-h-4 max-xl:min-w-4 max-xl:rounded max-xl:text-[10px]',
        'xl:text-base',
      )}
    >
      5
    </span>
  );
}

function DayCellPostTotal({ slots }: { slots: DaySlot[] }) {
  const { t } = useI18n();
  const counts = calendarCounts(slots);
  // Failure first, like the day summary: the breakdown only feeds the title
  // and the accessible name, never a number inside the cell.
  const breakdown = CALENDAR_GROUP_ORDER.filter((group) => counts[group] > 0)
    .map((group) => `${t(CALENDAR_GROUP_KEY[group])}: ${counts[group]}`)
    .join(', ');
  // Slot order: the strip reads as the day's timeline, left to right.
  const ordered = [...slots].sort((a, b) => a.slotAt.localeCompare(b.slotAt));
  const shown = ordered.slice(0, MAX_DAY_DOTS);
  const hidden = ordered.length - shown.length;
  return (
    <span data-day-post-total title={breakdown} className={DAY_POST_DOTS_CLASS}>
      {shown.map((slot, index) => {
        const group = calendarGroupOf(slot.status);
        return (
          <span
            key={`${slot.scheduleId}:${slot.slotAt}:${index}`}
            aria-hidden
            data-post-dot
            data-group={group}
            data-status={slot.status}
            className={cn(DAY_POST_DOT_CLASS, CALENDAR_GROUP_DOT[group])}
          />
        );
      })}
      {hidden > 0 && (
        <span
          aria-hidden
          data-day-post-overflow
          className="text-[10px] leading-none font-semibold text-muted-foreground tabular-nums"
        >
          +{hidden}
        </span>
      )}
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
// PostsDayButton — one day cell. A row of post dots (one per post, coloured
// by group; the per-status breakdown is only in the title and the day's
// rows). No persona names in the cell (the list below names them). Today
// colours the numeral gold. Selection fills that numeral with the brand
// chip. When both are true, a gold pip sits above the chip. The post dots
// stay below it, in their own row.
//---------------
export function PostsDayButton({ children, day, modifiers, className, ...props }: ComponentProps<typeof DayButton>) {
  const { slotsByDay } = useContext(DayCellContext);
  const key = dayKey(day.date);
  const slots = slotsByDay.get(key) ?? [];
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
        // shadcn Button paints a focus ring on the whole cell. Focus stays on the numeral.
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
        <span data-today-pip-slot className="flex h-2 w-full items-end justify-center">
          {isToday && selectedSingle && !isOutside ? (
            <span aria-hidden data-today-pip className={TODAY_PIP_CLASS} />
          ) : null}
        </span>
        <span
          data-day-numeral
          className={cn(
            'inline-flex shrink-0 items-center justify-center text-base leading-none',
            isOutside ? 'font-normal text-muted-foreground opacity-50' : 'font-semibold text-primary',
            isToday && isOutside && 'opacity-100',
            isToday && !selectedSingle && !isOutside && TODAY_NUMERAL_CLASS,
            selectedSingle && !isOutside && SELECTED_DAY_NUMERAL_CLASS,
            !(selectedSingle && !isOutside) && 'min-h-6',
          )}
        >
          {children}
        </span>
      </span>
      {slots.length > 0 && (
        // Clear of the chip, so a post dot never reads as part of the selection.
        <span aria-hidden className="mt-1 flex shrink-0 items-center justify-center">
          <DayCellPostTotal slots={slots} />
        </span>
      )}
    </Button>
  );
}
