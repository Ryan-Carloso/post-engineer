'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight, Play, TriangleAlert } from 'lucide-react';
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
import { CALENDAR_GROUP_ICON, CALENDAR_GROUP_KEY, CALENDAR_GROUP_PILL, STATUS_KEY, STATUS_STYLE, calendarGroupOf } from './status';

//---------------
// Cards of the posts list: scheduled posts (PostCard) and standalone video
// generations (GenerationCard). Layout, top to bottom: status pill (icon +
// label, so status never relies on color alone; a post card uses the
// calendar's group words, so the card, the legend and the day summary
// name a post the same way) and the time (plus the date outside the
// calendar's day list) with a chevron — the card opens the post detail —
// then the title with the persona under it and the video thumbnail when
// there is a video, the exact stage with the progress bar while the video
// is generating or publishing, and the network + account chips. A failed
// post shows a failure box instead of the chips: the reason, the accounts
// it failed for and a link to its details. Extracted from page.tsx, which
// is over the file-size cap.
//---------------

// Cards open the post detail: hovering one outlines it.
const CARD_BORDER = 'border-line shadow-[0_1px_2px_rgba(13,43,69,0.05)] hover:border-primary/40';
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

const StatusBadge = ({ status, label, style }: { status: string; label: string; style: string }) => {
  const Icon = CALENDAR_GROUP_ICON[calendarGroupOf(status)];
  return (
    <Badge variant="outline" data-status={status} className={cn('shrink-0 gap-1 border-transparent whitespace-nowrap', style)}>
      <Icon className="size-3" strokeWidth={3} aria-hidden />
      {label}
    </Badge>
  );
};

// Status badge left, when right, on one line: neither side wraps. The
// chevron says the card opens the post detail.
const CardHeader = ({ badge, when }: { badge: ReactNode; when: string }) => (
  <div className="flex items-center justify-between gap-2">
    {badge}
    <p className="flex min-w-0 items-center gap-1 text-[13px] whitespace-nowrap text-ink-soft tabular-nums">
      <span className="truncate">{when}</span>
      <ChevronRight data-card-chevron className="size-4 shrink-0 text-muted-text transition-transform group-hover/card:translate-x-0.5" aria-hidden />
    </p>
  </div>
);

// The title is the card's main line; the persona sits under it.
const CardTitle = ({ title, personaName }: { title: string; personaName: string }) => (
  <div className="min-w-0 flex-1">
    <p className="line-clamp-2 text-sm leading-snug font-semibold text-primary group-hover/card:underline">{title}</p>
    <p className="mt-1 truncate text-[13px] text-ink-soft">{personaName}</p>
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
// `onTint`: inside the red failure box the chips sit on the card color.
const AccountChips = ({ accounts, onTint = false }: { accounts: AccountOption[]; onTint?: boolean }) => (
  <ul className="flex min-w-0 flex-wrap gap-1.5">
    {accounts.slice(0, MAX_CHIPS).map((account) => (
      <li
        key={`${account.provider}:${account.id}`}
        className={cn(
          'flex max-w-full min-w-0 items-center gap-1 rounded-full py-0.5 pr-2 pl-1.5 text-xs font-medium text-ink-soft',
          onTint ? 'bg-card' : 'bg-sunken',
        )}
      >
        <ProviderIcon provider={account.provider} />
        <span className="truncate">{account.label}</span>
      </li>
    ))}
    {accounts.length > MAX_CHIPS && (
      <li className={cn('rounded-full px-2 py-0.5 text-xs font-semibold text-ink-soft', onTint ? 'bg-card' : 'bg-sunken')}>
        +{accounts.length - MAX_CHIPS}
      </li>
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
  // keeps the generic retryable/permanent copy, which says whether
  // scheduling the post again is worth it.
  const isFailed = slot.status === 'failed';
  const failureCode = isFailed ? categorizeGenerationError(slot.error) : 'unknown';
  const failureMessage =
    failureCode === 'unknown'
      ? t(slot.retryable === true ? 'posts.cardFailedRetryable' : 'posts.cardFailedPermanent')
      : t(GENERATION_ERROR_KEY[failureCode]);
  const group = calendarGroupOf(slot.status);
  // The card is not a single link: the failure box carries its own visible
  // "See details" action, and a link cannot nest another link. The main
  // content links to the post detail (the chevron says so); so does the
  // action. There is no retry endpoint: a failed post is scheduled again
  // by the user's AI agent, which the retryable copy says.
  return (
    <Card
      className={cn(
        'group/card flex h-full flex-col gap-0 rounded-xl p-4 transition-colors',
        CARD_BORDER,
        isFailed && 'border-destructive/40 hover:border-destructive/60',
      )}
    >
      <Link href={`/posts/${slot.id}`} className="block rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        <CardHeader
          badge={<StatusBadge status={slot.status} label={t(CALENDAR_GROUP_KEY[group])} style={CALENDAR_GROUP_PILL[group]} />}
          when={when}
        />
        <div className="mt-3 flex gap-3">
          <CardTitle title={slot.title ?? t('posts.unknownTitle')} personaName={personaName} />
          {thumbSrc !== null && <PostThumb src={thumbSrc} />}
        </div>
        {showProgress && (
          // The exact stage under the group pill ("In progress"), e.g.
          // "Generating video 45%".
          <div className="mt-3">
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-info">
              <span>{t(STATUS_KEY[slot.status] ?? 'posts.groupInProgress')}</span>
              <span className="tabular-nums">{slot.progress}%</span>
            </div>
            <div
              role="progressbar"
              aria-label={t('posts.progressLabel')}
              aria-valuenow={slot.progress}
              aria-valuemin={0}
              aria-valuemax={100}
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken"
            >
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${slot.progress}%` }} />
            </div>
          </div>
        )}
      </Link>
      {isFailed && (
        <FailureBox message={failureMessage}>
          {accounts.length > 0 && (
            <div className="mt-2.5">
              <p className="mb-1 text-xs font-semibold">{t('posts.cardFailedFor')}</p>
              <AccountChips accounts={accounts} onTint />
            </div>
          )}
          <Link
            href={`/posts/${slot.id}`}
            className="mt-2.5 inline-flex h-9 items-center gap-1 rounded-md border border-destructive/40 bg-card px-3 text-sm font-semibold text-destructive transition-colors hover:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t('posts.cardDetails')}
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        </FailureBox>
      )}
      {!isFailed && accounts.length > 0 && (
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
    <Link href={`/posts/${generation.generationId}`} className="group/card block h-full">
      <Card className={`flex h-full flex-col gap-0 rounded-xl p-4 transition-colors ${CARD_BORDER}`}>
        <CardHeader
          badge={
            <StatusBadge
              status={generation.status}
              label={t(GENERATION_STATUS_KEY[generation.status] ?? 'posts.statusPending')}
              style={STATUS_STYLE[generation.status] ?? STATUS_STYLE.pending}
            />
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
