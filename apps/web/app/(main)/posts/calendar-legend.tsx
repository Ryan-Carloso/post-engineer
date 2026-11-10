'use client';

import { Filter } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import {
  LEGEND_POST_TOTAL_SWATCH_CLASS,
  SELECTED_DAY_LEGEND_SWATCH_CLASS,
  TODAY_MARK_DOT_CLASS,
  TODAY_NUMERAL_WASH_CLASS,
  TODAY_TOP_BAR_CLASS,
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
        'flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-text xl:gap-x-4',
        className,
      )}
    >
      <li className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
        <span aria-hidden data-legend-post-total className={LEGEND_POST_TOTAL_SWATCH_CLASS} />
        {t('posts.calendarLegendPostCount')}
      </li>
      <li className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
        <span
          aria-hidden
          data-legend-today-mark
          className="pointer-events-none inline-flex h-9 w-8 flex-col items-stretch overflow-hidden rounded-md border border-line/40 bg-card"
        >
          <span data-legend-today-bar className={TODAY_TOP_BAR_CLASS} />
          <span className="flex flex-1 flex-col items-center justify-center gap-0.5 pb-0.5 pt-0.5">
            <span data-legend-today-wash className={cn(TODAY_NUMERAL_WASH_CLASS, 'size-4')} />
            <span data-legend-today-dot className={TODAY_MARK_DOT_CLASS} />
          </span>
        </span>
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
