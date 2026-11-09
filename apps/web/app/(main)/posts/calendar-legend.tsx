'use client';

import { Filter } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import { StatusMarker, TODAY_MARK_CLASS } from './calendar-markers';
import { CALENDAR_GROUP_KEY, CALENDAR_GROUP_ORDER } from './status';

export function CalendarLegend({ filtered = false, className }: { filtered?: boolean; className?: string }) {
  const { t } = useI18n();
  return (
    <ul className={cn('flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-text', className)}>
      {CALENDAR_GROUP_ORDER.map((group) => (
        <li key={group} className="flex items-center gap-1.5">
          <StatusMarker group={group} />
          {t(CALENDAR_GROUP_KEY[group])}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span aria-hidden className={cn('size-4 rounded-full', TODAY_MARK_CLASS)} />
        {t('posts.calendarToday')}
      </li>
      {filtered && (
        <li data-filter-hint className="flex items-center gap-1.5 font-semibold text-primary">
          <Filter className="size-3.5" aria-hidden />
          {t('posts.filterActive')}
        </li>
      )}
    </ul>
  );
}
