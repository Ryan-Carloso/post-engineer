'use client';

import { Filter } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import { StatusMarker, TODAY_LEGEND_CLASS } from './calendar-markers';
import { CALENDAR_GROUP_KEY, CALENDAR_GROUP_ORDER } from './status';

const SELECTED_LEGEND_CLASS =
  'inline-flex size-4 shrink-0 items-center justify-center rounded-sm outline-2 -outline-offset-2 outline-primary';

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
        'grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted-text max-xl:grid-cols-2 xl:flex xl:flex-wrap xl:gap-x-4 xl:gap-y-1',
        className,
      )}
    >
      {CALENDAR_GROUP_ORDER.map((group) => (
        <li key={group} className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
          <StatusMarker group={group} />
          {t(CALENDAR_GROUP_KEY[group])}
        </li>
      ))}
      <li className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
        <span aria-hidden className={TODAY_LEGEND_CLASS} />
        {t('posts.calendarToday')}
      </li>
      {showSelection && (
        <li className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
          <span aria-hidden className={SELECTED_LEGEND_CLASS} />
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
