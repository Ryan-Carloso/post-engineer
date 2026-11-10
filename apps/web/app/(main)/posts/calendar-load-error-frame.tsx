'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import { formatCalendarMonthCaption } from './calendar-days';

export function CalendarUnavailableFrame({
  year,
  month,
  legendClassName: _legendClassName,
  showLegend: _showLegend = false,
  children,
}: {
  year: number;
  month: number;
  firstWeekday?: 0 | 1;
  filtered?: boolean;
  legendClassName?: string;
  showLegend?: boolean;
  children: ReactNode;
}) {
  const { locale } = useI18n();
  const monthLabel = formatCalendarMonthCaption(year, month, locale);

  return (
    <div data-calendar-unavailable-frame className="w-full">
      <p className="text-base font-bold capitalize text-primary">{monthLabel}</p>
      <div
        data-calendar-load-error
        className={cn('mt-3 w-full rounded-lg border border-warning/35 bg-warning/12 px-4 py-4 sm:px-5')}
      >
        {children}
      </div>
    </div>
  );
}
