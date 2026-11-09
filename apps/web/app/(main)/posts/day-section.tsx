'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { CalendarCheck, CalendarPlus, CalendarX2, Filter, FilterX, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ScheduledSlot } from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { calendarCounts } from './calendar-days';
import { StatusMarker } from './calendar-markers';
import { CALENDAR_GROUP_KEY, CALENDAR_GROUP_ORDER } from './status';

//---------------
// The posts calendar's states around the grid: the summary of the selected
// day, the empty states (account, month, day, filter) and the load error.
// Presentational — the page decides which one shows. Posts are created by
// the user's AI agent over MCP (there is no create form in the web app), so
// every "next step" action leads to /recipes, where the API key and the
// ready-to-copy prompts live.
//---------------

export const CREATE_POSTS_HREF = '/recipes';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      data-empty-state
      className={cn(
        'flex flex-col items-center rounded-xl border border-dashed border-line bg-card text-center',
        compact ? 'gap-1.5 px-4 py-6' : 'gap-2 px-6 py-10',
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-sunken text-muted-text">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-primary">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}

function CreatePostsLink({ labelKey }: { labelKey: TranslationKey }) {
  const { t } = useI18n();
  return (
    <Link href={CREATE_POSTS_HREF} className={cn(buttonVariants({ size: 'sm' }), 'gap-1.5')}>
      <CalendarPlus aria-hidden />
      {t(labelKey)}
    </Link>
  );
}

// An account with no post in any month (no schedule yet, or schedules
// that never produced a post). Replaces the calendar and the filters,
// which would only be an empty grid and empty choices.
export function AccountEmptyState() {
  const { t } = useI18n();
  return (
    <EmptyState
      icon={CalendarPlus}
      title={t('posts.accountEmptyTitle')}
      description={t('posts.accountEmptyHint')}
      action={<CreatePostsLink labelKey="posts.accountEmptyAction" />}
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
  onGoToday,
}: {
  reason: 'filter' | 'month' | 'day';
  monthLabel: string;
  onClearFilters: () => void;
  // Omitted when the shown month already holds today.
  onGoToday?: () => void;
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
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {onGoToday !== undefined && (
              <Button type="button" size="sm" variant="outline" className="gap-1.5 bg-card text-primary hover:bg-sunken hover:text-primary" onClick={onGoToday}>
                <CalendarCheck aria-hidden />
                {t('posts.calendarGoToday')}
              </Button>
            )}
            <CreatePostsLink labelKey="posts.schedulePostsAction" />
          </div>
        }
      />
    );
  }
  return (
    <EmptyState
      compact
      icon={CalendarX2}
      title={t('posts.calendarDayNone')}
      description={t('posts.calendarDayNoneHint')}
      action={<CreatePostsLink labelKey="posts.schedulePostsAction" />}
    />
  );
}

// The selected day's counts, failure first, as plain text with the
// calendar's markers — only the groups the day actually has, and nothing
// for an empty day. Not chips: they are not filters.
export function DaySummary({ slots }: { slots: Pick<ScheduledSlot, 'status'>[] }) {
  const { t } = useI18n();
  const counts = calendarCounts(slots);
  const groups = CALENDAR_GROUP_ORDER.filter((group) => counts[group] > 0);
  if (groups.length === 0) return null;
  return (
    <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
      {groups.map((group) => (
        <li key={group} className="flex items-center gap-1.5">
          <StatusMarker group={group} />
          <span>
            {t(CALENDAR_GROUP_KEY[group])}: {counts[group]}
          </span>
        </li>
      ))}
    </ul>
  );
}

// The load error: one compact alert that names what failed and points at
// the page's single Refresh control (in the page header, which never moves,
// so the title and filters do not jump when the error appears or clears).
export function LoadErrorBanner({ messageKey }: { messageKey: TranslationKey }) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive-soft px-4 py-3 text-destructive"
    >
      <TriangleAlert className="mt-px size-5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">{t(messageKey)}</span> {t('posts.loadErrorRetryHint')}
      </p>
    </div>
  );
}
