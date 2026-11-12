'use client';

import { Filter } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import {
  LegendPostDotsSwatch,
  LegendSelectedDaySwatch,
  LegendTodaySwatch,
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
        'flex w-full items-center text-xs text-muted-text max-xl:flex-nowrap max-xl:gap-x-3 max-xl:gap-y-0 xl:flex-wrap xl:gap-x-4 xl:gap-y-1.5',
        className,
      )}
    >
      <li className="flex shrink-0 items-center gap-1 whitespace-nowrap max-xl:gap-1 xl:gap-1.5">
        <LegendPostDotsSwatch />
        {t('posts.calendarLegendPostCount')}
      </li>
      <li className="flex shrink-0 items-center gap-1 whitespace-nowrap max-xl:gap-1 xl:gap-1.5">
        <LegendTodaySwatch />
        {t('posts.calendarToday')}
      </li>
      {showSelection && (
        <li className="flex shrink-0 items-center gap-1 whitespace-nowrap max-xl:gap-1 xl:gap-1.5">
          <LegendSelectedDaySwatch />
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
