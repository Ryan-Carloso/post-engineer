'use client';

import { CalendarPlus, CalendarX2, Filter, FilterX } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { NewPostButton } from './mcp-onboard';

// The shared empty-state block lives in components/ui (one definition for
// every list and panel); re-exported here so the posts screens keep their
// existing import path. CREATE_POSTS_HREF stays on this module so the
// failure notice can keep its import.
export { EmptyState } from '@/components/ui/empty-state';
export { CREATE_POSTS_HREF } from '@/lib/mcp-onboard';

//---------------
// The posts calendar's states around the grid: the summary of the selected
// day and the empty states (account, month, day, filter). Presentational —
// the page decides which one shows. There is no create form: New post
// opens the MCP-first explanation.
//---------------

// An account with no post in any month (no schedule yet, or schedules
// that never produced a post). The page keeps the filters and a faint
// calendar, and shows this in the side panel.
export function AccountEmptyState() {
  const { t } = useI18n();
  return (
    <EmptyState
      icon={CalendarPlus}
      title={t('posts.accountEmptyTitle')}
      description={t('posts.accountEmptyHint')}
      action={<NewPostButton />}
    />
  );
}

// What the list under the calendar shows when it has no posts, scoped like
// its heading: a whole month (the heading names the month) that is empty or
// emptied by a filter, or one empty day in a month that has posts (the
// heading names the day). Every state offers a next step that is not a
// dead end: clear the filters, go back to today, or schedule posts.
export function DayEmptyState({
  reason,
  monthLabel,
  onClearFilters,
}: {
  reason: 'filter' | 'month' | 'day';
  monthLabel: string;
  onClearFilters: () => void;
}) {
  const { t } = useI18n();
  if (reason === 'filter') {
    return (
      <EmptyState
        compact
        icon={Filter}
        title={t('posts.filterMonthEmptyTitle', { month: monthLabel })}
        description={t('posts.filterEmptyHint')}
        action={
          <Button type="button" size="sm" variant="outline" className="gap-1.5 bg-card text-primary hover:bg-sunken hover:text-primary" onClick={onClearFilters}>
            <FilterX aria-hidden />
            {t('posts.clearFilters')}
          </Button>
        }
      />
    );
  }
  if (reason === 'month') {
    return (
      <EmptyState
        compact
        icon={CalendarX2}
        title={t('posts.calendarMonthEmptyTitle', { month: monthLabel })}
        description={t('posts.calendarMonthEmptyHint')}
        action={<NewPostButton className="h-8 min-w-0 shrink px-2 text-xs" />}
      />
    );
  }
  return (
    <EmptyState
      compact
      icon={CalendarX2}
      title={t('posts.calendarDayNone')}
      description={t('posts.calendarDayNoneHint')}
      action={<NewPostButton />}
    />
  );
}
