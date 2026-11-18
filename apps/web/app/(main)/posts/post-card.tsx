'use client';

import Link from 'next/link';
import { ChevronRight, TriangleAlert } from 'lucide-react';
import type { ScheduleConfig, VideoGeneration } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/lib/i18n/provider';
import type { Locale, TranslationKey } from '@/lib/i18n';
import { scheduleAccountIds, type AccountOption } from '@/lib/account-options';
import { GENERATION_ERROR_KEY } from '@/lib/generation/generation-errors';
import { cn } from '@/lib/utils';
import {
  CALENDAR_GROUP_ICON,
  STATUS_STYLE,
  calendarGroupOf,
  type CalendarGroup,
} from './status';

const CARD_BORDER = 'border-line shadow-[0_1px_2px_rgba(13,43,69,0.05)] hover:border-primary/40';

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

export function resolveSlotAccounts(schedule: ScheduleConfig | undefined, accounts: AccountOption[]): AccountOption[] {
  if (!schedule) return [];
  const ids = new Set(scheduleAccountIds(schedule));
  return accounts.filter((account) => ids.has(account.id));
}

export function videoUrlFor(taskId: string | null | undefined): string | null {
  return taskId ? `/api/persona/video-download/${encodeURIComponent(taskId)}/final-1.mp4` : null;
}

export const StatusBadge = ({
  status,
  label,
  style,
  icon: IconOverride,
  iconClassName,
}: {
  status: string;
  label: string;
  style: string;
  icon?: (typeof CALENDAR_GROUP_ICON)[CalendarGroup];
  iconClassName?: string;
}) => {
  const Icon = IconOverride ?? CALENDAR_GROUP_ICON[calendarGroupOf(status)];
  return (
    <Badge variant="outline" data-status={status} className={cn('shrink-0 gap-1 border-transparent whitespace-nowrap', style)}>
      <Icon
        className={cn('size-3', iconClassName)}
        strokeWidth={IconOverride === undefined ? 3 : 2.5}
        aria-hidden
      />
      {label}
    </Badge>
  );
};

export const GenerationCard = ({ generation, locale }: { generation: VideoGeneration; locale: Locale }) => {
  const { t } = useI18n();
  const videoUrl = videoUrlFor(generation.engineTaskId);
  const thumbSrc = generation.status === 'completed' ? videoUrl : null;
  const isFailed = generation.status === 'failed';
  const statusLabel = t(GENERATION_STATUS_KEY[generation.status] ?? 'posts.statusPending');
  const ariaLabel = `${statusLabel}: ${generation.videoSubject ?? t('posts.unknownTitle')}`;
  const failureBorderClass = isFailed && 'border-destructive/35 hover:border-destructive/55';
  const thumbIconClass = cn('size-4', isFailed ? 'text-destructive' : 'text-muted-text');
  const subject = generation.videoSubject ?? t('posts.unknownTitle');
  const personaLabel = generation.personaName ?? t('posts.personaFallback');
  const failureMessage = t(GENERATION_ERROR_KEY[generation.errorCode ?? 'unknown'] ?? 'posts.errorUnknown');
  const badgeStyle = STATUS_STYLE[generation.status] ?? STATUS_STYLE.pending;
  const thumb =
    thumbSrc !== null ? (
      <video src={`${thumbSrc}#t=0.1`} preload="metadata" muted playsInline className="size-full object-cover" />
    ) : (
      <span className="flex size-full items-center justify-center">
        <TriangleAlert className={thumbIconClass} aria-hidden />
      </span>
    );
  const failureBlock = isFailed && (
    <p data-generation-error className="mt-1 flex items-center gap-1.5 text-xs text-destructive">
      <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{failureMessage}</span>
    </p>
  );
  const refundBadge = generation.tokensRefunded && (
    <Badge variant="outline" className="hidden border-transparent bg-success-soft text-success sm:inline-flex">
      {t('posts.refundedBadge')}
    </Badge>
  );
  return (
    <Link
      href={`/posts/${generation.generationId}`}
      aria-label={ariaLabel}
      className="group/card block rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Card
        className={cn(
          'flex flex-row items-center gap-3 rounded-xl px-3 py-2.5 transition-colors',
          CARD_BORDER,
          failureBorderClass,
        )}
      >
        <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-sunken">{thumb}</div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-snug font-semibold text-primary">{subject}</p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">
              <span className="sr-only">{t('posts.cardPersonaLabel')}: </span>
              {personaLabel}
            </span>
            <span aria-hidden>·</span>
            <span className="shrink-0 tabular-nums">
              {formatDate(generation.createdAt, locale)} · {formatTime(generation.createdAt, locale)}
            </span>
          </p>
          {failureBlock}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {refundBadge}
          <StatusBadge status={generation.status} label={statusLabel} style={badgeStyle} />
          <ChevronRight className="size-4 text-muted-text transition-transform group-hover/card:translate-x-0.5" aria-hidden />
        </div>
      </Card>
    </Link>
  );
};
