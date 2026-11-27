'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import type { ScheduledSlot } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { ProviderIcon } from '@/components/provider-icon';
import { useI18n } from '@/lib/i18n/provider';
import type { Locale } from '@/lib/i18n';
import type { AccountOption } from '@/lib/account-options';
import { cn } from '@/lib/utils';
import {
  CALENDAR_GROUP_ICON,
  CALENDAR_GROUP_KEY,
  CALENDAR_GROUP_PILL,
  calendarGroupOf,
  slotDisplayStatus,
} from './status';
import { StatusBadge, formatDate, formatTime } from './post-card';
import { PublishAccountNotices } from './publish-user-notice';

const MAX_STATUS_ICONS = 3;

export function PostRow({
  slot,
  personaName,
  accounts,
  locale,
  timeOnly = false,
  hasAccess = true,
}: {
  slot: ScheduledSlot;
  personaName: string;
  accounts: AccountOption[];
  locale: Locale;
  timeOnly?: boolean;
  hasAccess?: boolean;
}) {
  const { t } = useI18n();
  const displayStatus = slotDisplayStatus(slot.status, hasAccess);
  const isHistory = slot.status === 'published' || slot.status === 'failed' || slot.status === 'expired';
  const shownAt = isHistory && slot.status !== 'expired' && slot.publishedAt ? slot.publishedAt : slot.slotAt;
  const when = timeOnly
    ? formatTime(shownAt, locale)
    : `${formatDate(shownAt, locale)} · ${formatTime(shownAt, locale)}`;
  const group = calendarGroupOf(displayStatus);
  const GroupIcon = CALENDAR_GROUP_ICON[group];
  const isFailed = slot.status === 'failed';
  const displayTitle = slot.title ?? t('posts.unknownTitle');

  return (
    <Link
      href={`/posts/${slot.id}`}
      aria-label={t('posts.cardOpenDetail', { title: displayTitle })}
      className="group/card block rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Card
        className={cn(
          'flex flex-col space-y-0 rounded-xl border-line px-3 py-2.5 shadow-[0_1px_2px_rgba(13,43,69,0.05)] transition-colors hover:border-primary/40',
          isFailed && 'border-destructive/35 hover:border-destructive/55',
        )}
      >
        <div className="flex items-center gap-3">
          <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-sunken">
            <span
              className={cn(
                'flex size-full items-center justify-center',
                isFailed ? 'text-destructive' : 'text-muted-text',
              )}
            >
              <GroupIcon className="size-4" aria-hidden />
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm leading-snug font-semibold text-primary">{displayTitle}</p>
            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span className="truncate">
                <span className="sr-only">{t('posts.cardPersonaLabel')}: </span>
                {personaName}
              </span>
              <span aria-hidden>·</span>
              <span className="shrink-0 tabular-nums">{when}</span>
              {accounts.length > 0 && (
                <span className="flex shrink-0 items-center gap-1">
                  <span aria-hidden>·</span>
                  {accounts.slice(0, MAX_STATUS_ICONS).map((account) => (
                    <ProviderIcon key={`${account.provider}:${account.id}`} provider={account.provider} />
                  ))}
                </span>
              )}
            </p>
            {isFailed && (
              <p data-post-row-error className="mt-1 flex items-center gap-1.5 text-xs text-destructive">
                <span className="truncate">{t('posts.cardFailedPermanent')}</span>
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge status={displayStatus} label={t(CALENDAR_GROUP_KEY[group])} style={CALENDAR_GROUP_PILL[group]} />
            <ChevronRight
              className="size-4 text-muted-text transition-transform group-hover/card:translate-x-0.5"
              aria-hidden
            />
          </div>
        </div>
        <PublishAccountNotices userNotices={slot.userNotices} compact />
      </Card>
    </Link>
  );
}
