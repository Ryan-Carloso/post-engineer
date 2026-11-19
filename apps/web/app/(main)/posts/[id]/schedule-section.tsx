'use client';

import { useI18n } from '@/lib/i18n/provider';
import type { ScheduledSlot, SlotDetailPayload } from '@/lib/api';

export function formatDateTime(value: string, locale: 'pt' | 'en', timeZone?: string | null): string {
  const tag = locale === 'pt' ? 'pt-BR' : 'en-US';
  if (timeZone) {
    try {
      return new Date(value).toLocaleString(tag, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone,
      });
    } catch {
      console.warn(`Ignoring invalid schedule timezone: ${timeZone}`);
    }
  }
  return new Date(value).toLocaleString(tag, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export const ScheduleSection = ({
  slot,
  timezone,
  publishMode,
  locale,
}: {
  slot: ScheduledSlot;
  timezone: string;
  publishMode: SlotDetailPayload['schedule']['publishMode'];
  locale: 'pt' | 'en';
}) => {
  const { t } = useI18n();
  const publishedAt = slot.status === 'published' ? slot.publishedAt : null;
  const shownAt = publishedAt ?? slot.slotAt;
  if (publishedAt === null && publishMode === 'asap') {
    return (
      <section aria-label={t('posts.scheduleLabel')} className="mt-6">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t('posts.asapLabel')}
        </p>
        <p className="mt-1 text-sm leading-6 text-primary">{t('posts.asapHint')}</p>
      </section>
    );
  }
  return (
    <section aria-label={t('posts.scheduleLabel')} className="mt-6">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {publishedAt ? t('posts.publishedOnLabel') : t('posts.scheduledForLabel')}
      </p>
      <p className="mt-1 text-sm font-semibold text-primary">
        {formatDateTime(shownAt, locale, timezone)}{' '}
        <span className="font-normal text-muted-foreground">({timezone})</span>
      </p>
    </section>
  );
};
