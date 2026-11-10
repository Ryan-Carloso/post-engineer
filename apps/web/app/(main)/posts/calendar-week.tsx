'use client';

import { createContext, useContext } from 'react';
import type { WeekProps } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { dayKey } from './calendar-days';
import { DayCellContext } from './calendar-markers';

export const CalendarChromeContext = createContext({ filtered: false, showLegend: true });

// A week with no posts uses a shorter row on desktop so empty months do not
// leave tall blank bands; phones keep every week row at full cell height so
// the grid rhythm stays even. Any day with a post keeps the full cell height.
export function PostsCalendarWeek({ week, className, ...props }: WeekProps) {
  const { slotsByDay } = useContext(DayCellContext);
  const hasPosts = week.days.some((day) => (slotsByDay.get(dayKey(day.date))?.length ?? 0) > 0);
  const displayMonth = week.days[0]?.displayMonth ?? week.days[0]?.date;
  const hasOutside =
    displayMonth !== undefined &&
    week.days.some(
      (day) =>
        day.date.getMonth() !== displayMonth.getMonth() || day.date.getFullYear() !== displayMonth.getFullYear(),
    );
  const compact = !hasPosts && !hasOutside;
  return (
    <tr
      {...props}
      data-week-has-posts={hasPosts ? 'true' : 'false'}
      data-week-outside-padding={hasOutside ? 'true' : undefined}
      className={cn(
        className,
        compact && 'xl:[&_[data-day-button]]:h-14 xl:[&_[data-day-button]]:min-h-14 xl:[&_[data-day-button]]:sm:h-16',
      )}
    />
  );
}

export function PostsCalendarWeeks({ children, className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={className} {...props}>
      {children}
    </tbody>
  );
}
