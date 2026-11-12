'use client';

import Link from 'next/link';
import { ChevronRight, Loader2 } from 'lucide-react';

import type { ScheduledSlot } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { ProviderIcon } from '@/components/provider-icon';
import { useI18n } from '@/lib/i18n/provider';
import type { Locale } from '@/lib/i18n';
import type { AccountOption } from '@/lib/account-options';
import { categorizeGenerationError, GENERATION_ERROR_KEY } from '@/lib/generation/generation-errors';
import { cn } from '@/lib/utils';
import {
  CALENDAR_GROUP_ICON,
  CALENDAR_GROUP_KEY,
  CALENDAR_GROUP_PILL,
  STATUS_KEY,
  STATUS_STYLE,
  calendarGroupOf,
} from './status';
import { StatusBadge, formatDate, formatTime, videoUrlFor } from './post-card';
import { PublishAccountNotices } from './publish-user-notice';

//---------------
// PostRow — a scheduled post as ONE dense row, shared by the calendar's day
// list and the history list: the same post reads the same way in both, and
// a full day fits on screen. The whole row opens the post detail (no
// repeated "open" button); the failure reason is the translated message for
// the slot's error, never the raw engine text. The tall card stays on the
// detail page, where there is room for the next action.
//---------------

const SLOT_VIDEO_STATUSES = new Set<ScheduledSlot['status']>(['ready', 'publishing', 'published']);
// Progress is live data only while work runs: an awaiting post at 0% looks
// stuck, and a ready video has nothing left to fill.
const SLOT_PROGRESS_STATUSES = new Set<ScheduledSlot['status']>(['generating', 'publishing']);
const MAX_STATUS_ICONS = 3;

export function PostRow({
  slot,
  personaName,
  accounts,
  locale,
  timeOnly = false,
}: {
  slot: ScheduledSlot;
  personaName: string;
  accounts: AccountOption[];
  locale: Locale;
  timeOnly?: boolean;
}) {
  const { t } = useI18n();
  const isHistory = slot.status === 'published' || slot.status === 'failed';
  const shownAt = isHistory && slot.publishedAt ? slot.publishedAt : slot.slotAt;
  const when = timeOnly
    ? formatTime(shownAt, locale)
    : `${formatDate(shownAt, locale)} · ${formatTime(shownAt, locale)}`;
  const group = calendarGroupOf(slot.status);
  const GroupIcon = CALENDAR_GROUP_ICON[group];
  const isFailed = slot.status === 'failed';
  const isGenerating = slot.status === 'generating';
  const showProgress = SLOT_PROGRESS_STATUSES.has(slot.status);
  const thumbSrc = SLOT_VIDEO_STATUSES.has(slot.status) ? videoUrlFor(slot.taskId) : null;
  const failureCode = isFailed ? categorizeGenerationError(slot.error) : 'unknown';
  const failureMessage =
    failureCode === 'unknown'
      ? t(slot.retryable === true ? 'posts.cardFailedRetryable' : 'posts.cardFailedPermanent')
      : t(GENERATION_ERROR_KEY[failureCode]);
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
            {thumbSrc !== null ? (
              <video src={`${thumbSrc}#t=0.1`} preload="metadata" muted playsInline className="size-full object-cover" />
            ) : (
              <span
                className={cn(
                  'flex size-full items-center justify-center',
                  isFailed ? 'text-destructive' : 'text-muted-text',
                )}
              >
                <GroupIcon className="size-4" aria-hidden />
              </span>
            )}
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
                <span className="truncate">{failureMessage}</span>
              </p>
            )}
            {showProgress && (
              <div className="mt-1.5 flex w-full items-center gap-2">
                <div
                  role="progressbar"
                  aria-label={t('posts.progressLabel')}
                  aria-valuenow={slot.progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken"
                >
                  <div className="h-full rounded-full bg-info transition-all" style={{ width: `${slot.progress}%` }} />
                </div>
                <span className="shrink-0 text-[11px] font-semibold text-info tabular-nums">{slot.progress}%</span>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {showProgress ? (
              <StatusBadge
                status={slot.status}
                label={t(STATUS_KEY[slot.status] ?? 'posts.groupInProgress')}
                style={STATUS_STYLE[slot.status] ?? CALENDAR_GROUP_PILL[group]}
                icon={isGenerating ? Loader2 : undefined}
                iconClassName={isGenerating ? 'animate-spin' : undefined}
              />
            ) : (
              <StatusBadge status={slot.status} label={t(CALENDAR_GROUP_KEY[group])} style={CALENDAR_GROUP_PILL[group]} />
            )}
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
