'use client';

import { createContext, useContext } from 'react';
import type { WeekProps } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { dayKey } from './calendar-days';
import { DayCellContext } from './calendar-markers';
import { CalendarLegend } from './calendar-legend';

export const CalendarChromeContext = createContext({ filtered: false, showLegend: true });

// A week with no posts uses a shorter row so empty months do not leave
// tall blank bands; any day with a post keeps the full cell height.
export function PostsCalendarWeek({ week, className, ...props }: WeekProps) {
  const { slotsByDay } = useContext(DayCellContext);
  const hasPosts = week.days.some((day) => (slotsByDay.get(dayKey(day.date))?.length ?? 0) > 0);
  return (
    <tr
      {...props}
      data-week-has-posts={hasPosts ? 'true' : 'false'}
      className={cn(className, !hasPosts && '[&_[data-day-button]]:h-14 [&_[data-day-button]]:sm:h-16')}
    />
  );
}

// On narrow screens the legend sits directly under the weekday row (first
// tbody row), not under the day list.
export function PostsCalendarWeeks({ children, className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  const { filtered, showLegend } = useContext(CalendarChromeContext);
  return (
    <tbody className={className} {...props}>
      {showLegend && (
        <tr className="xl:hidden" data-mobile-legend role="presentation">
          <td colSpan={7} className="px-0.5 pt-2 pb-0">
            <CalendarLegend filtered={filtered} />
          </td>
        </tr>
      )}
      {children}
    </tbody>
  );
}
