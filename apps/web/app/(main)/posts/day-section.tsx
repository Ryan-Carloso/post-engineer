'use client';

import Link from 'next/link';
import { CalendarPlus, CalendarX2, Filter, FilterX } from 'lucide-react';
import type { ScheduledSlot } from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { StatusBadge, formatTime } from './post-card';
import type { PostJoins } from './post-joins';
import {
  CALENDAR_GROUP_KEY,
  CALENDAR_GROUP_PILL,
  STATUS_KEY,
  STATUS_STYLE,
  calendarGroupOf,
  slotDisplayStatus,
} from './status';

export { EmptyState } from '@/components/ui/empty-state';

export const CREATE_POSTS_HREF = '/recipes';

export function NewPostButton({ className, testId }: { className?: string; testId?: string }) {
  const { t } = useI18n();
  return (
    <Button asChild size="sm" className={cn('shrink-0', className)} data-testid={testId}>
      <Link href={CREATE_POSTS_HREF}>
        <CalendarPlus aria-hidden />
        {t('posts.newPostAction')}
      </Link>
    </Button>
  );
}

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

export function DayListRow({ slot, joins, hasAccess = true }: { slot: ScheduledSlot; joins: PostJoins; hasAccess?: boolean }) {
  const { t, locale } = useI18n();
  const schedule = joins.scheduleById.get(slot.scheduleId);
  const personaId = schedule?.personaId ?? null;
  const personaName = personaId === null ? t('posts.noPersona') : joins.personaNameById.get(personaId) ?? t('posts.personaFallback');
  const displayStatus = slotDisplayStatus(slot.status, hasAccess);
  const isHistory = slot.status === 'published' || slot.status === 'failed' || slot.status === 'expired';
  const shownAt = isHistory && slot.status !== 'expired' && slot.publishedAt ? slot.publishedAt : slot.slotAt;
  const group = calendarGroupOf(displayStatus);
  const chipLabel = t(slot.status === 'cancelled' ? STATUS_KEY.cancelled : CALENDAR_GROUP_KEY[group]);
  const displayTitle = slot.title ?? t('posts.unknownTitle');
  return (
    <Link
      href={`/posts/${slot.id}`}
      aria-label={t('posts.cardOpenDetail', { title: displayTitle })}
      className="group/row flex items-center gap-3 py-2.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="w-11 shrink-0 text-xs font-medium text-muted-foreground tabular-nums">{formatTime(shownAt, locale)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{personaName}</span>
        <span className="block truncate text-sm font-semibold text-primary">{displayTitle}</span>
      </span>
      <StatusBadge
        status={displayStatus}
        label={chipLabel}
        style={STATUS_STYLE[displayStatus] ?? CALENDAR_GROUP_PILL[group]}
        icon={slot.status === 'cancelled' ? CalendarX2 : undefined}
      />
    </Link>
  );
}

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
