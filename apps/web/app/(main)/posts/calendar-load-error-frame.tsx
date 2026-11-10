'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function CalendarUnavailableFrame({
  children,
}: {
  year?: number;
  month?: number;
  firstWeekday?: 0 | 1;
  filtered?: boolean;
  legendClassName?: string;
  showLegend?: boolean;
  children: ReactNode;
}) {
  return (
    <div data-calendar-unavailable-frame className="w-full">
      <div
        data-calendar-load-error
        className={cn('w-full rounded-lg border border-warning/35 bg-warning/12 px-4 py-4 sm:px-5')}
      >
        {children}
      </div>
    </div>
  );
}
