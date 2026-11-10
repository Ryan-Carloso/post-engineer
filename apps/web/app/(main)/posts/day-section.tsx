'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { CalendarPlus, CalendarX2, Filter, FilterX, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
      {action !== undefined && <div className="mt-2 w-full min-w-0">{action}</div>}
    </div>
  );
}

function CreatePostsLink({ labelKey, className }: { labelKey: TranslationKey; className?: string }) {
  const { t } = useI18n();
  return (
    <Link href={CREATE_POSTS_HREF} className={cn(buttonVariants({ size: 'sm' }), 'shrink-0 gap-1.5 whitespace-nowrap', className)}>
      <CalendarPlus aria-hidden />
      {t(labelKey)}
    </Link>
  );
}

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
        action={<CreatePostsLink labelKey="posts.schedulePostsAction" className="h-8 min-w-0 shrink px-2 text-xs" />}
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

export function LoadErrorBanner({
  messageKey,
  noteKey,
  onRetry,
  compact = false,
}: {
  messageKey: TranslationKey;
  noteKey?: TranslationKey;
  onRetry: () => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive-soft px-4 py-3 text-ink',
        compact ? 'mx-auto w-full max-w-md items-center text-center' : 'items-start',
      )}
    >
      <p className={cn('flex gap-3 text-sm', compact ? 'items-center' : 'items-start')}>
        <TriangleAlert className={cn('size-5 shrink-0 text-destructive', compact ? '' : 'mt-px')} aria-hidden />
        <span className="font-semibold">{t(messageKey)}</span>
      </p>
      {noteKey !== undefined && (
        <p className={cn('text-sm text-muted-foreground', compact ? 'max-w-sm' : 'text-left')}>{t(noteKey)}</p>
      )}
      <Button type="button" size="sm" className={compact ? 'self-center' : undefined} onClick={onRetry}>
        {t('posts.loadErrorRetry')}
      </Button>
    </div>
  );
}
