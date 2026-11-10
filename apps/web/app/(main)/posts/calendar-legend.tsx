'use client';

import { Filter } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import {
  DAY_POST_TOTAL_CLASS,
  SELECTED_DAY_LEGEND_SWATCH_CLASS,
  TODAY_LEGEND_CLASS,
} from './calendar-markers';

export function CalendarLegend({
  filtered = false,
  showSelection = true,
  className,
}: {
  filtered?: boolean;
  showSelection?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <ul
      className={cn(
        'grid grid-cols-1 gap-y-1.5 text-xs text-muted-text max-xl:grid-cols-1 xl:grid-cols-none xl:flex xl:flex-wrap xl:gap-x-4 xl:gap-y-1',
        className,
      )}
    >
      <li className="flex min-w-0 items-center gap-1.5 max-xl:whitespace-normal xl:whitespace-nowrap">
        <span aria-hidden className={cn(DAY_POST_TOTAL_CLASS, 'pointer-events-none px-1.5')}>
          1
        </span>
        {t('posts.calendarLegendPostCount')}
      </li>
      <li className="flex min-w-0 items-center gap-1.5 max-xl:whitespace-normal xl:whitespace-nowrap">
        <span aria-hidden className={TODAY_LEGEND_CLASS} />
        {t('posts.calendarToday')}
      </li>
      {showSelection && (
        <li className="flex min-w-0 items-center gap-1.5 max-xl:whitespace-normal xl:whitespace-nowrap">
          <span aria-hidden data-legend-selected-day className={SELECTED_DAY_LEGEND_SWATCH_CLASS}>
            5
          </span>
          {t('posts.calendarLegendSelected')}
        </li>
      )}
      {filtered && (
        <li data-filter-hint className="col-span-2 flex items-center gap-1.5 font-semibold text-primary xl:col-span-1">
          <Filter className="size-3.5" aria-hidden />
          {t('posts.filterActive')}
        </li>
      )}
    </ul>
  );
}
