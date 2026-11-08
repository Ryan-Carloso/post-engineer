'use client';

import Link from 'next/link';
import { Check, Clock, Play, TriangleAlert } from 'lucide-react';
import type { ScheduledSlot, ScheduleConfig, VideoGeneration } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { ProviderIcon } from '@/components/provider-icon';
import { useI18n } from '@/lib/i18n/provider';
import type { Locale, TranslationKey } from '@/lib/i18n';
import { scheduleAccountIds, type AccountOption } from '@/lib/account-options';
import { GENERATION_ERROR_KEY } from '@/lib/generation/generation-errors';
import { cn } from '@/lib/utils';
import { STATUS_KEY, STATUS_STYLE, statusGroupOf, type StatusGroup } from './status';

//---------------
// Cards of the posts list: scheduled posts (PostCard) and standalone video
// generations (GenerationCard). Layout, top to bottom: status badge (icon +
// label, so status never relies on color alone), date + time, persona and
// title with the video thumbnail, inline failure message, then the network +
// account chips. Extracted from page.tsx, which is over the file-size cap.
//---------------

const GROUP_ICON: Record<StatusGroup, typeof Check> = {
  inProgress: Clock,
  published: Check,
  failed: TriangleAlert,
};

const CARD_BORDER = 'border-line shadow-[0_1px_2px_rgba(13,43,69,0.05)] hover:border-line';
const MAX_CHIPS = 3;
const SLOT_VIDEO_STATUSES = new Set<ScheduledSlot['status']>(['ready', 'publishing', 'published']);

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

//---------------
// resolveSlotAccounts — human-readable account labels for one slot, based
// on the schedule's targeted account ids per provider.
//---------------
export function resolveSlotAccounts(schedule: ScheduleConfig | undefined, accounts: AccountOption[]): AccountOption[] {
  if (!schedule) return [];
  const ids = new Set(scheduleAccountIds(schedule));
  return accounts.filter((account) => ids.has(account.id));
}

//---------------
// videoUrlFor — the engine download proxy serves the final render for a
// task; only slots whose video was actually produced have one.
//---------------
function videoUrlFor(taskId: string | null | undefined): string | null {
  return taskId ? `/api/persona/video-download/${encodeURIComponent(taskId)}/final-1.mp4` : null;
}

//---------------
// PostThumb — the 72×72 thumbnail on the card body's right: the video
// itself (metadata-only preload, muted, control-less — playback happens
// in the detail modal) under a small play glyph. The src carries a
// #t=0.1 media fragment so the browser seeks and paints that frame as
// the thumbnail — preload="metadata" alone renders an empty box in
// Chrome even when the video exists.
//---------------
const PostThumb = ({ src }: { src: string | null }) => {
  const thumbSrc = src ? `${src}#t=0.1` : null;
  return (
    <div className="relative w-18 shrink-0">
      <AspectRatio ratio={1} className="w-18 rounded-[9px] bg-sunken">
        {thumbSrc ? <video src={thumbSrc} preload="metadata" muted playsInline className="size-full object-cover" /> : null}
      </AspectRatio>
      {thumbSrc && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Play className="size-4 fill-white text-white drop-shadow" />
        </span>
      )}
    </div>
  );
};

const StatusBadge = ({ status, label }: { status: string; label: string }) => {
  const Icon = GROUP_ICON[statusGroupOf(status)];
  return (
    <Badge variant="outline" className={cn('gap-1 border-transparent', STATUS_STYLE[status] ?? STATUS_STYLE.pending)}>
      <Icon className="size-3" strokeWidth={3} aria-hidden />
      {label}
    </Badge>
  );
};

//---------------
// AccountChips — one chip per targeted account (network glyph + label),
// capped; the remainder collapses into "+N". Labels truncate so a long
// handle never breaks the card on a 375px screen.
//---------------
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
}: {
  slot: ScheduledSlot;
  personaName: string;
  accounts: AccountOption[];
  locale: Locale;
}) => {
  const { t } = useI18n();
  const isHistory = slot.status === 'published' || slot.status === 'failed';
  const shownAt = isHistory && slot.publishedAt ? slot.publishedAt : slot.slotAt;
  const videoUrl = videoUrlFor(slot.taskId);
  const hasThumb = SLOT_VIDEO_STATUSES.has(slot.status) && videoUrl !== null;
  // Progress is live data on the list card too: a freshly created post lands
  // here at 0% and the minute poll fills in the engine's number.
  const showProgress = statusGroupOf(slot.status) === 'inProgress';
  return (
    <Link href={`/posts/${slot.id}`} className="block h-full">
      <Card className={`flex h-full flex-col gap-0 rounded-xl p-4 transition-colors ${CARD_BORDER}`}>
        <div className="flex items-center justify-between gap-2">
          <StatusBadge status={slot.status} label={t(STATUS_KEY[slot.status] ?? 'posts.statusPending')} />
          <p className="text-xs text-muted-foreground">
            {formatDate(shownAt, locale)} · {formatTime(shownAt, locale)}
          </p>
        </div>
        <div className="mt-3 flex gap-3">
          <p className="line-clamp-3 flex-1 text-sm leading-snug text-primary">
            <span className="font-semibold">{personaName}</span>
            {' — '}
            <span className="text-muted-foreground">{slot.title ?? t('posts.unknownTitle')}</span>
          </p>
          <PostThumb src={hasThumb ? videoUrl : null} />
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
        {slot.status === 'failed' && (
          // The raw slot.error is engine/upstream text and is never rendered
          // here; the detail page owns the full failure view.
          <p className="mt-3 line-clamp-2 text-xs text-destructive">
            {t(slot.retryable === true ? 'posts.cardFailedRetryable' : 'posts.cardFailedPermanent')}
          </p>
        )}
        {accounts.length > 0 && (
          <div className="mt-auto pt-4">
            <AccountChips accounts={accounts} />
          </div>
        )}
      </Card>
    </Link>
  );
};

//---------------
// Generation history cards — standalone video generations (manual/debug),
// not scheduled posts. A failed generation shows the friendly, translated
// error for its error_code; the raw engine text stays in the database for
// support and is never rendered (it may contain paths or upstream bodies).
//---------------
export const GenerationCard = ({ generation, locale }: { generation: VideoGeneration; locale: Locale }) => {
  const { t } = useI18n();
  const videoUrl = videoUrlFor(generation.engineTaskId);
  const hasThumb = generation.status === 'completed' && videoUrl !== null;
  return (
    <Link href={`/posts/${generation.generationId}`} className="block h-full">
      <Card className={`flex h-full flex-col gap-0 rounded-xl p-4 transition-colors ${CARD_BORDER}`}>
        <div className="flex items-center justify-between gap-2">
          <StatusBadge
            status={generation.status}
            label={t(GENERATION_STATUS_KEY[generation.status] ?? 'posts.statusPending')}
          />
          <p className="text-xs text-muted-foreground">
            {formatDate(generation.createdAt, locale)} · {formatTime(generation.createdAt, locale)}
          </p>
        </div>
        <div className="mt-3 flex gap-3">
          <div className="flex-1">
            <p className="line-clamp-3 text-sm leading-snug text-primary">
              <span className="font-semibold">{generation.personaName ?? t('posts.personaFallback')}</span>
              {' — '}
              <span className="text-muted-foreground">{generation.videoSubject ?? t('posts.unknownTitle')}</span>
            </p>
            {generation.status === 'failed' && (
              <p className="mt-2 line-clamp-2 text-xs text-destructive">
                {t(GENERATION_ERROR_KEY[generation.errorCode ?? 'unknown'] ?? 'posts.errorUnknown')}
              </p>
            )}
          </div>
          <PostThumb src={hasThumb ? videoUrl : null} />
        </div>
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
