'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { Check, Clock, Film, Image as ImageIcon, TriangleAlert, X } from 'lucide-react';
import { useApprovalQueue, isSlotExpired } from '@/lib/approval-queue';
import { useMounted } from '@/hooks/use-mounted';
import { useApproveSlotMutation, useRejectSlotMutation } from '@/lib/api-approval';
import { type ScheduledSlot } from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import { ProviderIcon } from '@/components/provider-icon';
import { cn } from '@/lib/utils';
import { formatDate, formatTime, resolveSlotAccounts, StatusBadge } from './post-card';
import { STATUS_KEY, STATUS_STYLE } from './status';
import type { PostJoins } from './post-joins';
import { RescheduleEditor } from './reschedule-editor';

const MAX_STATUS_ICONS = 3;

function ApprovalMedia({ slot }: { slot: ScheduledSlot }) {
  const { t } = useI18n();
  const media = slot.media ?? null;
  const displayTitle = slot.title ?? t('posts.unknownTitle');
  if (media?.kind === 'image' && media.url !== null) {
    return (
      <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-sunken">
        <Image src={media.url} alt={displayTitle} width={56} height={56} unoptimized className="size-full object-cover" />
      </div>
    );
  }
  if (media?.kind === 'upload' && media.url !== null) {
    return (
      <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-black">
        <video src={media.url} muted playsInline preload="metadata" className="size-full object-cover" />
      </div>
    );
  }
  const KindIcon = media?.kind === 'image' ? ImageIcon : media?.kind === 'upload' ? Film : Clock;
  const kindLabel =
    media?.kind === 'image'
      ? t('posts.approvalMediaImage')
      : media?.kind === 'upload'
        ? t('posts.approvalMediaVideo')
        : t('posts.approvalMediaUnknown');
  return (
    <div
      className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-sunken"
      role="img"
      aria-label={kindLabel}
      data-media-kind={media?.kind ?? 'unknown'}
    >
      <span className="flex size-full items-center justify-center text-muted-text">
        <KindIcon className="size-4" aria-hidden />
      </span>
    </div>
  );
}

function ApprovalQueueRow({ slot, joins }: { slot: ScheduledSlot; joins: PostJoins }) {
  const { t, locale } = useI18n();
  const approve = useApproveSlotMutation();
  const reject = useRejectSlotMutation();
  const [rescheduling, setRescheduling] = useState(false);
  const [confirmingReject, setConfirmingReject] = useState(false);
  const schedule = joins.scheduleById.get(slot.scheduleId);
  const personaId = schedule?.personaId ?? null;
  const personaName =
    personaId === null ? t('posts.noPersona') : (joins.personaNameById.get(personaId) ?? t('posts.personaFallback'));
  const accounts = resolveSlotAccounts(schedule, joins.accountOptions);
  const expired = schedule?.publishMode === 'asap' ? false : isSlotExpired(slot);
  const canReschedule = expired && schedule?.publishMode === 'scheduled';
  const busy = approve.isPending || reject.isPending;
  const displayTitle = slot.title ?? t('posts.unknownTitle');
  const description = slot.description;
  const when = `${formatDate(slot.slotAt, locale)} · ${formatTime(slot.slotAt, locale)}`;

  return (
    <Card
      data-testid="approval-queue-row"
      data-slot-id={slot.id}
      className="flex flex-col space-y-0 rounded-xl border-line px-3 py-2.5 shadow-[0_1px_2px_rgba(13,43,69,0.05)]"
    >
      <div className="flex items-start gap-3">
        <ApprovalMedia slot={slot} />
        <div className="min-w-0 flex-1">
          <Link
            href={`/posts/${slot.id}`}
            className="truncate text-sm leading-snug font-semibold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {displayTitle}
          </Link>
          {description !== undefined && description !== null && description.length > 0 ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{description}</p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">{t('posts.unknownCaption')}</p>
          )}
          <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
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
          {expired && (
            <p data-testid="approval-expired" className="mt-1 flex items-center gap-1.5 text-xs font-medium text-warning">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
              {t('posts.approvalExpired')}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={slot.status} label={t(STATUS_KEY[slot.status])} style={STATUS_STYLE[slot.status]} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 pl-17">
        <Button
          type="button"
          size="sm"
          data-testid="approval-approve"
          onClick={() => approve.mutate(slot.id)}
          disabled={busy || expired}
        >
          <Check className="size-4" aria-hidden />
          {t('posts.approvalApprove')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="approval-reject"
          onClick={() => setConfirmingReject(true)}
          disabled={busy}
        >
          <X className="size-4" aria-hidden />
          {t('posts.approvalReject')}
        </Button>
        {canReschedule &&
          (rescheduling ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setRescheduling(false)} disabled={busy}>
              {t('posts.cancel')}
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" data-testid="approval-reschedule" onClick={() => setRescheduling(true)} disabled={busy}>
              {t('posts.reschedule')}
            </Button>
          ))}
      </div>
      {rescheduling && schedule && (
        <div className="pl-17">
          <RescheduleEditor
            slotId={slot.id}
            slotAt={slot.slotAt}
            timezone={schedule.timezone}
            onDone={() => setRescheduling(false)}
            onCancel={() => setRescheduling(false)}
          />
        </div>
      )}
      {approve.isError && (
        <p className="mt-2 pl-17 text-sm text-destructive" role="alert">
          {t('posts.approvalApproveError')}
        </p>
      )}
      {reject.isError && (
        <p className="mt-2 pl-17 text-sm text-destructive" role="alert">
          {t('posts.approvalRejectError')}
        </p>
      )}
      <ConfirmDialog
        tone="destructive"
        open={confirmingReject}
        onClose={() => setConfirmingReject(false)}
        onConfirm={() => reject.mutate(slot.id, { onSettled: () => setConfirmingReject(false) })}
        pending={reject.isPending}
        detail={displayTitle}
        title={t('posts.approvalRejectTitle')}
        body={t('posts.approvalRejectBody')}
        cancelLabel={t('posts.cancel')}
        confirmLabel={t('posts.approvalReject')}
      />
    </Card>
  );
}

export function ApprovalQueue({ joins }: { joins: PostJoins }) {
  const { t } = useI18n();
  const mounted = useMounted();
  const queue = useApprovalQueue();
  if (!mounted || queue.isLoading || queue.isError || queue.count === 0) return null;
  return (
    <section data-testid="approval-queue" aria-label={t('posts.approvalTitle')} className="mt-4 sm:mt-6">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-bold tracking-[-0.01em] text-primary">{t('posts.approvalTitle')}</h2>
        <span
          data-testid="approval-queue-count"
          className={cn(
            'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums',
            'bg-warning-soft text-warning',
          )}
        >
          {queue.count}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        {queue.slots.map((slot) => (
          <ApprovalQueueRow key={slot.id} slot={slot} joins={joins} />
        ))}
      </div>
      {queue.count > queue.slots.length && (
        <p data-testid="approval-queue-truncated" className="mt-2 text-xs text-muted-foreground">
          {t('posts.approvalTruncated', { shown: queue.slots.length, count: queue.count })}
        </p>
      )}
    </section>
  );
}
