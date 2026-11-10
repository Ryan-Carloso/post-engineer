'use client';

import { Filter } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import {
  LEGEND_POST_TOTAL_SWATCH_CLASS,
  LEGEND_TODAY_BAR_SWATCH_CLASS,
  SELECTED_DAY_LEGEND_SWATCH_CLASS,
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
        'flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-text max-xl:flex-nowrap max-xl:gap-x-2 xl:gap-x-4',
        className,
      )}
    >
      <li className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
        <span aria-hidden data-legend-post-total className={LEGEND_POST_TOTAL_SWATCH_CLASS} />
        {t('posts.calendarLegendPostCount')}
      </li>
      <li className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
        <span aria-hidden data-legend-today-bar className={LEGEND_TODAY_BAR_SWATCH_CLASS} />
        {t('posts.calendarToday')}
      </li>
      {showSelection && (
        <li className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
          <span aria-hidden data-legend-selected-day className={SELECTED_DAY_LEGEND_SWATCH_CLASS} />
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
