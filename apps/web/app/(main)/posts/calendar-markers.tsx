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

function DayCellStatusSummary({ groups, counts, total }: { groups: CalendarGroup[]; counts: Record<CalendarGroup, number>; total: number }) {
  if (groups.length === 1) {
    const group = groups[0];
    return <StatusMarker group={group} count={counts[group]} />;
  }
  return (
    <span
      data-cell-summary
      className="inline-flex h-[18px] max-w-full min-w-0 items-center gap-0.5 overflow-hidden rounded-full bg-sunken px-1 text-[10px] leading-none font-bold text-ink-soft tabular-nums"
    >
      <span className="flex shrink-0 items-center gap-px" aria-hidden>
        {groups.map((group) => (
          <span key={group} data-status-dot={group} className={cn('size-1.5 rounded-full', CALENDAR_GROUP_DOT[group])} />
        ))}
      </span>
      <span data-total-count className="shrink-0">
        {total}
      </span>
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

//---------------
// PostsDayButton — one day cell. One compact marker, or status dots with a
// total when several groups share the day. No persona names or avatars in
// the cell (the list below names them). Today is an amber disc on the
// number only. Selection is a navy outline on an overflow-visible cell so
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
        'aspect-auto h-20 w-full max-w-full min-w-0 flex-col items-center justify-start gap-1 overflow-visible px-0.5 pt-1 sm:h-24 [&>span]:text-sm',
        !isOutside && '[&>span]:opacity-100',
        isOutside &&
          'text-muted-foreground hover:bg-transparent hover:text-muted-foreground active:bg-transparent data-[selected-single=true]:text-muted-foreground',
        !isOutside && 'hover:bg-sunken hover:text-primary',
        'data-[selected-single=true]:bg-transparent data-[selected-single=true]:outline-2 data-[selected-single=true]:-outline-offset-2 data-[selected-single=true]:outline-primary data-[selected-single=true]:hover:bg-transparent',
        !isOutside && 'data-[selected-single=true]:text-primary',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'group-data-[focused=true]/day:bg-transparent group-data-[focused=true]/day:ring-0 group-data-[focused=true]/day:shadow-none',
        '[&_[data-marker]_svg]:size-2.5',
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
          isToday && TODAY_MARK_CLASS,
          isToday && isOutside && 'opacity-100',
        )}
      >
        {children}
      </span>
      {slots.length > 0 && (
        <span aria-hidden className="flex w-full min-w-0 flex-nowrap items-center justify-center overflow-hidden">
          <DayCellStatusSummary groups={groups} counts={counts} total={slots.length} />
        </span>
      )}
    </Button>
  );
}
