'use client';

import { useI18n } from '@/lib/i18n/provider';
import type { ScheduledSlot, SlotDetailPayload } from '@/lib/api';

//---------------
// formatDateTime — a UTC instant rendered in the viewer’s locale, in
// the schedule’s timezone when one is given (falling back to the
// viewer’s zone on a garbage timezone, never blanking the date).
//---------------
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
      // A schedule row with a garbage timezone must not blank the date —
      // fall through to the viewer's zone below. The warn keeps the bad
      // value diagnosable: the UI only ever sends IANA names, so reaching
      // here signals drift or a direct API caller. Plain console.warn (not
      // the central logger, which is server-only via posthog-server) —
      // echoing the schedule's own timezone to the viewer's own console
      // exfiltrates nothing.
      console.warn(`Ignoring invalid schedule timezone: ${timeZone}`);
    }
  }
  return new Date(value).toLocaleString(tag, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

//---------------
// ScheduleSection — when the post goes out (or went out): the slot time
// rendered in the schedule's own timezone, with the IANA name beside it,
// so "10:00" is never ambiguous about whose 10:00 it is. An ASAP post has
// no scheduled time: until it is published the section says so plainly.
//---------------
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
