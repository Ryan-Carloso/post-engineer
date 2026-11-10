'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight, Play, TriangleAlert } from 'lucide-react';
import type { ScheduledSlot, ScheduleConfig, VideoGeneration } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { ProviderIcon } from '@/components/provider-icon';
import { useI18n } from '@/lib/i18n/provider';
import type { Locale, TranslationKey } from '@/lib/i18n';
import { scheduleAccountIds, type AccountOption } from '@/lib/account-options';
import { categorizeGenerationError, GENERATION_ERROR_KEY } from '@/lib/generation/generation-errors';
import { cn } from '@/lib/utils';
import { CALENDAR_GROUP_ICON, CALENDAR_GROUP_KEY, CALENDAR_GROUP_PILL, STATUS_KEY, STATUS_STYLE, calendarGroupOf } from './status';
import { CREATE_POSTS_HREF } from './day-section';
import { PublishAccountNotices } from './publish-user-notice';

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
// post shows a failure box instead of the chips: a short reason, the
// accounts it failed for, a link to Recipes and a secondary details link.
// Extracted from page.tsx, which is over the file-size cap.
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

// 72×72 media tile: real preview when a video exists; a dashed quiet
// placeholder otherwise so every non-failed card shares one layout. The
// #t=0.1 fragment makes Chrome paint a frame; preload="metadata" alone
// renders an empty box.
const PostThumb = ({ src }: { src: string }) => (
  <div className="relative w-18">
    <AspectRatio ratio={1} className="w-18 overflow-hidden rounded-[9px] bg-sunken">
      <video src={`${src}#t=0.1`} preload="metadata" muted playsInline className="size-full object-cover" />
    </AspectRatio>
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ink/10">
      <Play className="size-4 fill-primary text-primary drop-shadow-md" />
    </span>
  </div>
);

const PostCardMedia = ({ src, noPreviewLabel }: { src: string | null; noPreviewLabel: string }) => {
  const [previewReady, setPreviewReady] = useState(false);
  if (src !== null && !previewReady) {
    return (
      <>
        <video
          className="hidden"
          src={`${src}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          onLoadedData={() => setPreviewReady(true)}
          onError={() => setPreviewReady(false)}
        />
        <p data-card-no-preview className="mt-1.5 border-l-2 border-warning/35 pl-2 text-xs font-medium text-warning/90">
          {noPreviewLabel}
        </p>
      </>
    );
  }
  if (src !== null && previewReady) {
    return (
      <div className="mt-2">
        <PostThumb src={src} />
      </div>
    );
  }
  return (
    <p data-card-no-preview className="mt-1.5 border-l-2 border-warning/35 pl-2 text-xs font-medium text-warning/90">
      {noPreviewLabel}
    </p>
  );
};

const StatusBadge = ({ status, label, style }: { status: string; label: string; style: string }) => {
  const Icon = CALENDAR_GROUP_ICON[calendarGroupOf(status)];
  return (
    <Badge variant="outline" data-status={status} className={cn('shrink-0 gap-1 border-transparent whitespace-nowrap', style)}>
      <Icon className="size-3" strokeWidth={3} aria-hidden />
      {label}
    </Badge>
  );
};

const CardHeader = ({
  badge,
  when,
  whenHint,
}: {
  badge: ReactNode;
  when: string;
  whenHint?: string;
}) => (
  <div data-card-header className="flex w-full items-start gap-2">
    <div className="shrink-0">{badge}</div>
    <p className="ml-auto min-w-0 text-right text-[13px] text-ink-soft tabular-nums">
      <span data-card-when className="inline-flex max-w-full flex-col items-end gap-0.5 leading-tight">
        {whenHint !== undefined && (
          <span data-card-when-kind className="text-[10px] font-medium text-muted-foreground">
            {whenHint}
          </span>
        )}
        <span className="whitespace-nowrap">{when}</span>
      </span>
    </p>
  </div>
);

const CardOpenAction = ({ label }: { label: string }) => (
  <div className="mt-3 border-t border-line pt-3">
    <span
      data-card-open
      className="flex min-h-10 w-full items-center justify-center gap-1 rounded-lg border border-line bg-card px-3 py-2 text-sm font-semibold text-primary shadow-[0_1px_0_rgba(13,43,69,0.06)]"
    >
      <span className="whitespace-nowrap">{label}</span>
      <ChevronRight
        data-card-chevron
        className="size-4 shrink-0 text-muted-text transition-transform group-hover/card:translate-x-0.5"
        aria-hidden
      />
    </span>
  </div>
);

// The title is the card's main line; the persona sits under it.
const CardTitle = ({
  title,
  personaName,
  personaLabel,
}: {
  title: string;
  personaName: string;
  personaLabel: string;
}) => (
  <div className="min-w-0 flex-1">
    <p className="line-clamp-2 text-sm leading-snug font-semibold text-primary">{title}</p>
    <p className="mt-1 truncate text-[13px] text-ink-soft">
      <span className="sr-only">{personaLabel}: </span>
      <span className="text-muted-foreground">{personaLabel}:</span> {personaName}
    </p>
  </div>
);

// The failure reason, full length (never clamped: a cut-off reason hides
// exactly the part that says what went wrong). The tint marks the box; the
// words stay ink so the message is not red on pink.
const FailureBox = ({ message, children }: { message: string; children?: ReactNode }) => (
  <div className="mt-3 rounded-lg bg-destructive-soft p-3 text-ink">
    <p className="flex gap-2 text-sm leading-snug">
      <TriangleAlert className="mt-px size-4 shrink-0 text-destructive" aria-hidden />
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
  const timeKindKey = isHistory && slot.publishedAt ? 'posts.cardTimePublished' : 'posts.cardTimeScheduled';
  const when = timeOnly
    ? formatTime(shownAt, locale)
    : `${formatDate(shownAt, locale)} · ${formatTime(shownAt, locale)}`;
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
  const generatingCue = timeOnly && slot.status === 'generating';
  const displayTitle = slot.title ?? t('posts.unknownTitle');
  // The card is not a single link: the failure box carries its own actions,
  // and a link cannot nest another link. The main content links to the post
  // detail (the chevron says so). There is no retry endpoint, so the primary
  // action opens Recipes, where the post is scheduled again.
  return (
    <Card
      className={cn(
        'group/card flex h-full flex-col gap-0 rounded-xl p-4 transition-colors',
        CARD_BORDER,
        isFailed && 'border-destructive/40 hover:border-destructive/60',
      )}
    >
      <Link
        href={`/posts/${slot.id}`}
        aria-label={t('posts.cardOpenDetail', { title: displayTitle })}
        className="block rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {generatingCue ? (
          <div data-card-header className="flex w-full items-start gap-2">
            <p className="text-sm font-semibold text-info">{t(STATUS_KEY.generating)}</p>
            <p className="ml-auto text-right text-xs text-muted-foreground tabular-nums">
              <span className="sr-only">{t(timeKindKey)} </span>
              <span data-card-when>{when}</span>
            </p>
          </div>
        ) : (
          <CardHeader
            badge={<StatusBadge status={slot.status} label={t(CALENDAR_GROUP_KEY[group])} style={CALENDAR_GROUP_PILL[group]} />}
            when={when}
            whenHint={timeOnly ? t(timeKindKey) : undefined}
          />
        )}
        <div className="mt-3">
          <CardTitle title={displayTitle} personaName={personaName} personaLabel={t('posts.cardPersonaLabel')} />
          {!isFailed && <PostCardMedia src={thumbSrc} noPreviewLabel={t('posts.cardNoPreview')} />}
        </div>
        {showProgress && (
          <div className={cn('mt-3', generatingCue && 'rounded-lg border border-info/25 bg-info-soft/40 p-2.5')}>
            {!generatingCue && (
              <p className="text-xs font-semibold text-info">{t(STATUS_KEY[slot.status] ?? 'posts.groupInProgress')}</p>
            )}
            <div className={cn('flex w-full items-center gap-2', generatingCue ? 'mt-0' : 'mt-1.5')}>
              <div
                role="progressbar"
                aria-label={t('posts.progressLabel')}
                aria-valuenow={slot.progress}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken"
              >
                <div className="h-full rounded-full bg-info transition-all" style={{ width: `${slot.progress}%` }} />
              </div>
              <span className="shrink-0 text-xs font-semibold tabular-nums text-info">{slot.progress}%</span>
            </div>
          </div>
        )}
        <PublishAccountNotices status={slot.status} userNotices={slot.userNotices} compact />
        {!isFailed && accounts.length > 0 && (
          <div className="mt-3">
            <AccountChips accounts={accounts} />
          </div>
        )}
        {!isFailed && <CardOpenAction label={t('posts.cardOpen')} />}
      </Link>
      {isFailed && (
        <FailureBox message={failureMessage}>
          {accounts.length > 0 && (
            <div className="mt-2.5">
              <p className="mb-1 text-xs font-semibold">{t('posts.cardFailedFor')}</p>
              <AccountChips accounts={accounts} onTint />
            </div>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <Link href={CREATE_POSTS_HREF} className={cn(buttonVariants({ size: 'sm' }), 'gap-1.5')}>
              {t('posts.cardScheduleAgain')}
            </Link>
            <Link
              href={`/posts/${slot.id}`}
              className="text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {t('posts.cardDetails')}
            </Link>
          </div>
        </FailureBox>
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
            personaLabel={t('posts.cardPersonaLabel')}
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
        <CardOpenAction label={t('posts.cardOpen')} />
      </Card>
    </Link>
  );
};
