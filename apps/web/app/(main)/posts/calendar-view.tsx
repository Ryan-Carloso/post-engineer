'use client';

import { createContext, useCallback, useContext, useMemo, type ComponentProps } from 'react';
import type { DayButton } from 'react-day-picker';
import { enUS, ptBR } from 'react-day-picker/locale';
import type { ScheduledSlot } from '@/lib/api';
import type { Locale } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { Calendar, CalendarDayButton } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { INTL_TAG, cellMarkers, dateFromKey, dayKey, groupCounts } from './calendar-days';
import { GROUP_ICON, GROUP_KEY, GROUP_STYLE, STATUS_GROUP_ORDER } from './status';

// CalendarView — month calendar on the shadcn Calendar (react-day-picker:
// grid semantics, keyboard navigation, focus). Each day shows per-post status
// markers (icon + color; over 3 posts collapse into "+N"). Day buckets use the
// viewer's browser timezone (calendar-days.ts). Data and the selected day's
// posts live in the page.

interface CalendarViewProps {
  year: number;
  month: number; // 0-based
  firstWeekday: 0 | 1;
  slotsByDay: Map<string, Pick<ScheduledSlot, 'status'>[]>;
  selectedKey: string | null;
  todayKey: string;
  onSelect: (key: string) => void;
  onMonthChange: (year: number, month: number) => void;
}

const DAY_PICKER_LOCALE: Record<Locale, typeof enUS> = { pt: ptBR, en: enUS };

// The DayButton component is passed to react-day-picker once; the per-day
// slots reach it through context so a data refresh never remounts the grid
// (which would drop keyboard focus).
const SlotsContext = createContext<Map<string, Pick<ScheduledSlot, 'status'>[]>>(new Map());

function PostsDayButton({ children, ...props }: ComponentProps<typeof DayButton>) {
  const slotsByDay = useContext(SlotsContext);
  const { t } = useI18n();
  const slots = slotsByDay.get(dayKey(props.day.date)) ?? [];
  const { markers, overflow } = cellMarkers(slots);
  return (
    <CalendarDayButton
      {...props}
      className="aspect-auto h-auto min-h-12 justify-start gap-1 py-1.5 sm:h-16 [&>span]:opacity-100"
    >
      <span className="text-sm font-semibold tabular-nums">{children}</span>
      {slots.length > 0 && (
        <span className="flex flex-wrap items-center justify-center gap-0.5" aria-hidden>
          {markers.map((group, index) => {
            const Icon = GROUP_ICON[group];
            return (
              <span key={index} data-group={group} className={cn('inline-flex size-3.5 items-center justify-center rounded-full sm:size-4', GROUP_STYLE[group])}>
                <Icon className="size-2.5" strokeWidth={3} />
              </span>
            );
          })}
          {overflow > 0 && <span className="text-[10px] font-bold">{t('posts.calendarMore', { count: overflow })}</span>}
        </span>
      )}
    </CalendarDayButton>
  );
}

export function CalendarView({
  year,
  month,
  firstWeekday,
  slotsByDay,
  selectedKey,
  todayKey,
  onSelect,
  onMonthChange,
}: CalendarViewProps) {
  const { t, locale } = useI18n();
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(INTL_TAG[locale], { dateStyle: 'full' }), [locale]);

  // Memoized so a data refresh that leaves slotsByDay untouched hands
  // react-day-picker the same label function (and labels object) instead of
  // a new one on every render, which would re-render the day buttons.
  const labelDayButton = useCallback(
    (date: Date): string => {
      const slots = slotsByDay.get(dayKey(date)) ?? [];
      const fullDate = dateFormat.format(date);
      if (slots.length === 0) return t('posts.calendarDayEmpty', { date: fullDate });
      const counts = groupCounts(slots);
      const summary = STATUS_GROUP_ORDER.filter((group) => counts[group] > 0)
        .map((group) => `${t(GROUP_KEY[group])}: ${counts[group]}`)
        .join(', ');
      return t('posts.calendarDayLabel', { date: fullDate, summary });
    },
    [slotsByDay, dateFormat, t],
  );
  const labels = useMemo(
    () => ({
      labelDayButton,
      labelPrevious: () => t('posts.calendarPrevMonth'),
      labelNext: () => t('posts.calendarNextMonth'),
    }),
    [labelDayButton, t],
  );

  return (
    <div className="rounded-xl border border-line bg-card p-2 sm:p-4">
      <SlotsContext.Provider value={slotsByDay}>
        <Calendar
          mode="single"
          required
          locale={DAY_PICKER_LOCALE[locale]}
          weekStartsOn={firstWeekday}
          fixedWeeks
          month={new Date(year, month, 1)}
          onMonthChange={(date) => onMonthChange(date.getFullYear(), date.getMonth())}
          today={dateFromKey(todayKey)}
          selected={selectedKey === null ? undefined : dateFromKey(selectedKey)}
          onSelect={(date) => onSelect(dayKey(date))}
          labels={labels}
          className="w-full bg-transparent p-0 [--cell-size:--spacing(10)]"
          classNames={{
            root: 'w-full',
            caption_label: 'text-base font-bold capitalize text-primary',
            // Rectangular cells (shadcn's are square), so the 6-week month stays short.
            day: 'group/day relative h-full w-full select-none p-0 text-center',
          }}
          components={{ DayButton: PostsDayButton }}
        />
      </SlotsContext.Provider>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-text">
          {STATUS_GROUP_ORDER.map((group) => {
            const Icon = GROUP_ICON[group];
            return (
              <li key={group} className="flex items-center gap-1.5">
                <span className={cn('inline-flex size-4 items-center justify-center rounded-full', GROUP_STYLE[group])}>
                  <Icon className="size-2.5" strokeWidth={3} aria-hidden />
                </span>
                {t(GROUP_KEY[group])}
              </li>
            );
          })}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const now = dateFromKey(todayKey);
            onMonthChange(now.getFullYear(), now.getMonth());
            onSelect(todayKey);
          }}
        >
          {t('posts.calendarToday')}
        </Button>
      </div>
    </div>
  );
}
