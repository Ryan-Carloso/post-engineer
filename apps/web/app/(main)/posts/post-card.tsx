'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Play, RotateCcw, TriangleAlert } from 'lucide-react';
import type { ScheduledSlot, ScheduleConfig, VideoGeneration } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { ProviderIcon } from '@/components/provider-icon';
import { useI18n } from '@/lib/i18n/provider';
import type { Locale, TranslationKey } from '@/lib/i18n';
import { scheduleAccountIds, type AccountOption } from '@/lib/account-options';
import { categorizeGenerationError, GENERATION_ERROR_KEY } from '@/lib/generation/generation-errors';
import { cn } from '@/lib/utils';
import { GROUP_ICON, STATUS_KEY, STATUS_STYLE, statusGroupOf } from './status';

//---------------
// Cards of the posts list: scheduled posts (PostCard) and standalone video
// generations (GenerationCard). Layout, top to bottom: status badge (icon +
// label, so status never relies on color alone) and the time (plus the
// date outside the calendar's day list), the title with the persona under
// it and the video thumbnail when there is a video, the progress bar while
// the video is generating or publishing, a failure box, then the network +
// account chips. A failed slot that can be retried shows its Try again
// action inside the failure box. Extracted from page.tsx, which is over
// the file-size cap.
//---------------

const CARD_BORDER = 'border-line shadow-[0_1px_2px_rgba(13,43,69,0.05)] hover:border-line';
const MAX_CHIPS = 3;
const SLOT_VIDEO_STATUSES = new Set<ScheduledSlot['status']>(['ready', 'publishing', 'published']);
// Progress is shown only while work is running: an awaiting post at 0%
// looks stuck, and a ready video has nothing left to fill.
const SLOT_PROGRESS_STATUSES = new Set<ScheduledSlot['status']>(['generating', 'publishing']);

const GENERATION_STATUS_KEY: Record<string, TranslationKey> = {
  pending: 'posts.statusPending',
  running: 'posts.statusRunning',
  completed: 'posts.statusCompleted',
  failed: 'posts.statusFailed',
};

export function formatDate(value: string, locale: Locale): string {
  return new Date(value).toLocaleDateString(locale === 'pt' ? 'pt-BR' : 'en-US', { dateStyle: 'medium' });
}

export function formatTime(value: string, locale: Locale): string {
  return new Date(value).toLocaleTimeString(locale === 'pt' ? 'pt-BR' : 'en-US', { timeStyle: 'short' });
}

// Account labels of the accounts a slot's schedule targets.
export function resolveSlotAccounts(schedule: ScheduleConfig | undefined, accounts: AccountOption[]): AccountOption[] {
  if (!schedule) return [];
  const ids = new Set(scheduleAccountIds(schedule));
  return accounts.filter((account) => ids.has(account.id));
}

// The engine download proxy serves a task's final render.
function videoUrlFor(taskId: string | null | undefined): string | null {
  return taskId ? `/api/persona/video-download/${encodeURIComponent(taskId)}/final-1.mp4` : null;
}

// 72×72 video thumbnail, only for a post that has a video: a placeholder
// tile on every other card was noise. The #t=0.1 fragment makes Chrome
// paint a frame; preload="metadata" alone renders an empty box.
const PostThumb = ({ src }: { src: string }) => (
  <div className="relative w-18 shrink-0">
    <AspectRatio ratio={1} className="w-18 overflow-hidden rounded-[9px] bg-sunken">
      <video src={`${src}#t=0.1`} preload="metadata" muted playsInline className="size-full object-cover" />
    </AspectRatio>
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <Play className="size-4 fill-white text-white drop-shadow" />
    </span>
  </div>
);

const StatusBadge = ({ status, label }: { status: string; label: string }) => {
  const Icon = GROUP_ICON[statusGroupOf(status)];
  return (
    <Badge
      variant="outline"
      className={cn('shrink-0 gap-1 border-transparent whitespace-nowrap', STATUS_STYLE[status] ?? STATUS_STYLE.pending)}
    >
      <Icon className="size-3" strokeWidth={3} aria-hidden />
      {label}
    </Badge>
  );
};

// Status badge left, when right, on one line: neither side wraps.
const CardHeader = ({ badge, when }: { badge: ReactNode; when: string }) => (
  <div className="flex items-center justify-between gap-2">
    {badge}
    <p className="min-w-0 truncate text-xs whitespace-nowrap text-muted-foreground tabular-nums">{when}</p>
  </div>
);

// The title is the card's main line; the persona sits under it.
const CardTitle = ({ title, personaName }: { title: string; personaName: string }) => (
  <div className="min-w-0 flex-1">
    <p className="line-clamp-2 text-sm leading-snug font-semibold text-primary">{title}</p>
    <p className="mt-1 truncate text-xs text-muted-foreground">{personaName}</p>
  </div>
);

// The failure reason, full length (never clamped: a cut-off reason hides
// exactly the part that says what went wrong), in a red box.
const FailureBox = ({ message, children }: { message: string; children?: ReactNode }) => (
  <div className="mt-3 rounded-lg bg-destructive-soft p-3 text-destructive">
    <p className="flex gap-2 text-sm leading-snug font-medium">
      <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </p>
    {children}
  </div>
);

// One chip per account (glyph + truncated label), capped with "+N".
const AccountChips = ({ accounts }: { accounts: AccountOption[] }) => (
  <ul className="flex min-w-0 flex-wrap gap-1.5">
    {accounts.slice(0, MAX_CHIPS).map((account) => (
      <li
        key={`${account.provider}:${account.id}`}
        className="flex max-w-full min-w-0 items-center gap-1 rounded-full bg-sunken py-0.5 pr-2 pl-1.5 text-[11px] font-medium text-ink-soft"
      >
        <ProviderIcon provider={account.provider} />
        <span className="truncate">{account.label}</span>
      </li>
    ))}
    {accounts.length > MAX_CHIPS && (
      <li className="rounded-full bg-sunken px-2 py-0.5 text-[11px] font-semibold text-muted-text">+{accounts.length - MAX_CHIPS}</li>
    )}
  </ul>
);

export const PostCard = ({
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
}) => {
  const { t } = useI18n();
  const isHistory = slot.status === 'published' || slot.status === 'failed';
  const shownAt = isHistory && slot.publishedAt ? slot.publishedAt : slot.slotAt;
  const when = timeOnly ? formatTime(shownAt, locale) : `${formatDate(shownAt, locale)} · ${formatTime(shownAt, locale)}`;
  const videoUrl = videoUrlFor(slot.taskId);
  const thumbSrc = SLOT_VIDEO_STATUSES.has(slot.status) ? videoUrl : null;
  // Progress is live data on the list card too: the minute poll fills in
  // the engine's number while the video is generating or publishing.
  const showProgress = SLOT_PROGRESS_STATUSES.has(slot.status);
  // The failure reason is the categorized, translated message for the
  // slot's engine error — never the raw engine text. An unrecognized error
  // keeps the generic retryable/permanent copy.
  const failureCode = slot.status === 'failed' ? categorizeGenerationError(slot.error) : 'unknown';
  const failureMessage =
    failureCode === 'unknown'
      ? t(slot.retryable === true ? 'posts.cardFailedRetryable' : 'posts.cardFailedPermanent')
      : t(GENERATION_ERROR_KEY[failureCode]);
  // The card is not a single link: a failed retryable slot carries a visible
  // "Try again" action, and a link cannot nest another link. The main
  // content links to the post detail; the retry action links there too —
  // the detail page is where a failed post is retried (no regenerate
  // endpoint exists).
  const showRetry = slot.status === 'failed' && slot.retryable === true;
  return (
    <Card
      className={cn(
        'flex h-full flex-col gap-0 rounded-xl p-4 transition-colors',
        CARD_BORDER,
        slot.status === 'failed' && 'border-destructive/40 hover:border-destructive/40',
      )}
    >
      <Link href={`/posts/${slot.id}`} className="block">
        <CardHeader
          badge={<StatusBadge status={slot.status} label={t(STATUS_KEY[slot.status] ?? 'posts.groupScheduled')} />}
          when={when}
        />
        <div className="mt-3 flex gap-3">
          <CardTitle title={slot.title ?? t('posts.unknownTitle')} personaName={personaName} />
          {thumbSrc !== null && <PostThumb src={thumbSrc} />}
        </div>
        {showProgress && (
          <div className="mt-3 flex items-center gap-2">
            <div
              role="progressbar"
              aria-label={t('posts.progressLabel')}
              aria-valuenow={slot.progress}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken"
            >
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${slot.progress}%` }} />
            </div>
            <span className="shrink-0 text-[11px] font-semibold text-primary tabular-nums">{slot.progress}%</span>
          </div>
        )}
      </Link>
      {slot.status === 'failed' && (
        <FailureBox message={failureMessage}>
          {showRetry && (
            <Link
              href={`/posts/${slot.id}`}
              className="mt-2.5 inline-flex h-9 items-center gap-1.5 rounded-md border border-destructive/40 bg-card px-3 text-sm font-semibold text-destructive transition-colors hover:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <RotateCcw className="size-4" aria-hidden />
              {t('posts.cardRetry')}
            </Link>
          )}
        </FailureBox>
      )}
      {accounts.length > 0 && (
        <div className="mt-3">
          <AccountChips accounts={accounts} />
        </div>
      )}
    </Card>
  );
};

// Standalone video generations. A failure shows the translated message for
// its error_code, never the raw engine text.
export const GenerationCard = ({ generation, locale }: { generation: VideoGeneration; locale: Locale }) => {
  const { t } = useI18n();
  const videoUrl = videoUrlFor(generation.engineTaskId);
  const thumbSrc = generation.status === 'completed' ? videoUrl : null;
  return (
    <Link href={`/posts/${generation.generationId}`} className="block h-full">
      <Card className={`flex h-full flex-col gap-0 rounded-xl p-4 transition-colors ${CARD_BORDER}`}>
        <CardHeader
          badge={
            <StatusBadge status={generation.status} label={t(GENERATION_STATUS_KEY[generation.status] ?? 'posts.statusPending')} />
          }
          when={`${formatDate(generation.createdAt, locale)} · ${formatTime(generation.createdAt, locale)}`}
        />
        <div className="mt-3 flex gap-3">
          <CardTitle
            title={generation.videoSubject ?? t('posts.unknownTitle')}
            personaName={generation.personaName ?? t('posts.personaFallback')}
          />
          {thumbSrc !== null && <PostThumb src={thumbSrc} />}
        </div>
        {generation.status === 'failed' && (
          <FailureBox message={t(GENERATION_ERROR_KEY[generation.errorCode ?? 'unknown'] ?? 'posts.errorUnknown')} />
        )}
        {generation.tokensRefunded && (
          <div className="mt-auto pt-4">
            <Badge variant="outline" className="border-transparent bg-success-soft text-success">
              {t('posts.refundedBadge')}
            </Badge>
          </div>
        )}
      </Card>
    </Link>
  );
};
