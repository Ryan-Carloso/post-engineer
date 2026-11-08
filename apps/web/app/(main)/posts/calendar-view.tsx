'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Check, ChevronLeft, ChevronRight, Clock, TriangleAlert } from 'lucide-react';
import type { ScheduledSlot } from '@/lib/api';
import type { Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  INTL_TAG,
  buildMonthGrid,
  cellMarkers,
  dateFromKey,
  dayKey,
  groupCounts,
  moveFocus,
  weekdayLabels,
} from './calendar-days';
import { GROUP_STYLE, STATUS_GROUP_ORDER, type StatusGroup } from './status';

//---------------
// CalendarView — presentational month grid (ARIA grid pattern). One cell per
// day showing per-post status markers (icon + color, never color alone; more
// than 3 posts collapse into "+N"). Roving tabindex: arrows move between
// days, Home/End jump within the week, PageUp/PageDown change month, Enter /
// Space select. Day buckets are in the viewer's browser timezone — see
// calendar-days.ts. Data fetching and the day's post list live in the page.
//---------------

const GROUP_ICON: Record<StatusGroup, typeof Check> = {
  inProgress: Clock,
  published: Check,
  failed: TriangleAlert,
};

export interface CalendarLabels {
  grid: string;
  prev: string;
  next: string;
  today: string;
  groups: Record<StatusGroup, string>;
  dayLabel: (date: string, summary: string) => string;
  dayEmpty: (date: string) => string;
  more: (count: number) => string;
}

interface CalendarViewProps {
  year: number;
  month: number; // 0-based
  locale: Locale;
  firstWeekday: 0 | 1;
  slotsByDay: Map<string, Pick<ScheduledSlot, 'status'>[]>;
  selectedKey: string | null;
  focusKey: string;
  todayKey: string;
  disabled?: boolean;
  labels: CalendarLabels;
  onSelect: (key: string) => void;
  onFocusChange: (key: string) => void;
  onMonthChange: (year: number, month: number) => void;
}

export function CalendarView({
  year,
  month,
  locale,
  firstWeekday,
  slotsByDay,
  selectedKey,
  focusKey,
  todayKey,
  disabled = false,
  labels,
  onSelect,
  onFocusChange,
  onMonthChange,
}: CalendarViewProps) {
  const grid = useMemo(() => buildMonthGrid(year, month, firstWeekday), [year, month, firstWeekday]);
  const weekdays = useMemo(() => weekdayLabels(locale, firstWeekday), [locale, firstWeekday]);
  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat(INTL_TAG[locale], { month: 'long', year: 'numeric' }).format(new Date(year, month, 1)),
    [locale, year, month],
  );
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(INTL_TAG[locale], { dateStyle: 'full' }), [locale]);
  // The roving tab stop must exist in the visible grid: after a month change
  // the remembered focus day may be gone, so fall back to the 1st of the month.
  const tabStop = grid.some((week) => week.some((day) => day.key === focusKey)) ? focusKey : dayKey(new Date(year, month, 1));
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  // Only keyboard navigation moves DOM focus; a plain re-render must not steal it.
  const shouldFocus = useRef(false);

  useEffect(() => {
    if (!shouldFocus.current) return;
    shouldFocus.current = false;
    buttons.current.get(focusKey)?.focus();
  }, [focusKey, year, month]);

  const goTo = (target: Date) => {
    shouldFocus.current = true;
    onFocusChange(dayKey(target));
    if (target.getFullYear() !== year || target.getMonth() !== month) {
      // Staying inside the 6-week grid keeps the month; leaving the displayed
      // month by keyboard changes it.
      const inGrid = grid.some((week) => week.some((day) => day.key === dayKey(target)));
      if (!inGrid) onMonthChange(target.getFullYear(), target.getMonth());
    }
  };

  const shiftMonth = (delta: number) => onMonthChange(...monthParts(year, month + delta));

  return (
    <div className="rounded-xl border border-line bg-card p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold tracking-[-0.01em] text-primary" aria-live="polite">
          {monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}
        </h2>
        <div className="flex items-center gap-1">
          <button type="button" aria-label={labels.prev} disabled={disabled} onClick={() => shiftMonth(-1)} className={NAV_BUTTON}>
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const now = dateFromKey(todayKey);
              onMonthChange(now.getFullYear(), now.getMonth());
              onSelect(todayKey);
            }}
            className={cn(NAV_BUTTON, 'px-3 text-xs font-semibold')}
          >
            {labels.today}
          </button>
          <button type="button" aria-label={labels.next} disabled={disabled} onClick={() => shiftMonth(1)} className={NAV_BUTTON}>
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      <div role="grid" aria-label={labels.grid} aria-busy={disabled}>
        <div role="row" className="grid grid-cols-7">
          {weekdays.map((weekday) => (
            <div
              key={weekday.long}
              role="columnheader"
              aria-label={weekday.long}
              className="pb-1 text-center text-[11px] font-semibold text-muted-text uppercase"
            >
              {weekday.short}
            </div>
          ))}
        </div>
        {grid.map((week) => (
          <div role="row" key={week[0].key} className="grid grid-cols-7">
            {week.map((day) => {
              const slots = slotsByDay.get(day.key) ?? [];
              const { markers, overflow } = cellMarkers(slots);
              const counts = groupCounts(slots);
              const summary = STATUS_GROUP_ORDER.filter((group) => counts[group] > 0)
                .map((group) => `${labels.groups[group]}: ${counts[group]}`)
                .join(', ');
              const fullDate = dateFormat.format(day.date);
              const isSelected = selectedKey === day.key;
              return (
                <div key={day.key} role="gridcell" aria-selected={isSelected} className="p-0.5">
                  <button
                    type="button"
                    ref={(node) => {
                      if (node) buttons.current.set(day.key, node);
                      else buttons.current.delete(day.key);
                    }}
                    tabIndex={day.key === tabStop ? 0 : -1}
                    aria-label={slots.length === 0 ? labels.dayEmpty(fullDate) : labels.dayLabel(fullDate, summary)}
                    aria-current={day.key === todayKey ? 'date' : undefined}
                    aria-pressed={isSelected}
                    onClick={() => {
                      onFocusChange(day.key);
                      onSelect(day.key);
                    }}
                    onKeyDown={(event) => {
                      const target = moveFocus(event.key, day.date, firstWeekday);
                      if (target === null) return;
                      event.preventDefault();
                      goTo(target);
                    }}
                    className={cn(
                      'flex h-18 min-h-0 w-full flex-col items-center justify-start gap-1 overflow-hidden rounded-lg border p-0.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 sm:h-24 sm:p-1',
                      isSelected ? 'border-primary bg-sunken' : 'border-transparent hover:bg-surface',
                      day.inMonth ? 'text-ink' : 'text-faint',
                      day.key === todayKey && 'ring-1 ring-brand',
                    )}
                  >
                    <span className={cn('font-semibold tabular-nums', day.key === todayKey && 'text-brand')}>{day.date.getDate()}</span>
                    {slots.length > 0 && (
                      <span className="flex flex-wrap items-center justify-center gap-0.5" aria-hidden>
                        {markers.map((group, index) => {
                          const Icon = GROUP_ICON[group];
                          return (
                            <span key={index} data-group={group} className={cn('inline-flex size-3 items-center justify-center rounded-full sm:size-4', GROUP_STYLE[group])}>
                              <Icon className="size-2" strokeWidth={3} />
                            </span>
                          );
                        })}
                        {overflow > 0 && <span className="text-[10px] font-bold text-muted-text">{labels.more(overflow)}</span>}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-text">
        {STATUS_GROUP_ORDER.map((group) => {
          const Icon = GROUP_ICON[group];
          return (
            <li key={group} className="flex items-center gap-1.5">
              <span className={cn('inline-flex size-4 items-center justify-center rounded-full', GROUP_STYLE[group])}>
                <Icon className="size-2.5" strokeWidth={3} aria-hidden />
              </span>
              {labels.groups[group]}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const NAV_BUTTON =
  'inline-flex h-9 min-h-0 items-center justify-center rounded-lg border border-input bg-card px-2 text-primary hover:bg-surface disabled:opacity-50';

function monthParts(year: number, month: number): [number, number] {
  const date = new Date(year, month, 1);
  return [date.getFullYear(), date.getMonth()];
}
