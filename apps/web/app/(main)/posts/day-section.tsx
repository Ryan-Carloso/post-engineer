'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { CalendarPlus, CalendarX2, Filter, RefreshCw, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ScheduledSlot } from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';
import { buttonVariants } from '@/components/ui/button';
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

// A brand-new account: no schedule, so no post in any month. Replaces the
// calendar, which would only be an empty grid.
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

// What the list under the calendar shows when the selected day has no
// posts: a filter that hides everything, a month without posts, or one
// empty day in a month that has some.
export function DayEmptyState({ reason, monthLabel }: { reason: 'filter' | 'month' | 'day'; monthLabel: string }) {
  const { t } = useI18n();
  if (reason === 'filter') {
    return <EmptyState compact icon={Filter} title={t('posts.noResultsForFilter')} description={t('posts.filterEmptyHint')} />;
  }
  if (reason === 'month') {
    return (
      <EmptyState
        icon={CalendarX2}
        title={t('posts.calendarMonthEmptyTitle', { month: monthLabel })}
        description={t('posts.calendarMonthEmptyHint')}
        action={<CreatePostsLink labelKey="posts.schedulePostsAction" />}
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

// The load error: one compact alert with the only refresh control on the
// page while it shows (the header one hides).
export function LoadErrorBanner({ messageKey, onRetry, retrying }: { messageKey: TranslationKey; onRetry: () => void; retrying: boolean }) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive-soft px-4 py-3 text-destructive"
    >
      <TriangleAlert className="size-5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 text-sm font-semibold">{t(messageKey)}</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-on-ink hover:bg-accent-hover disabled:opacity-50"
      >
        <RefreshCw className={cn('size-4', retrying && 'animate-spin')} aria-hidden />
        {t('posts.refresh')}
      </button>
    </div>
  );
}
