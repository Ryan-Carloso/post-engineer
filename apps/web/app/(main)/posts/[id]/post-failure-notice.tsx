'use client';

import Link from 'next/link';
import { CalendarPlus, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n/provider';
import type { PublishUserNotice } from '@/lib/publish-user-notice';
import { CREATE_POSTS_HREF } from '../day-section';
import { PublishAccountNotices } from '../publish-user-notice';

//---------------
// PostFailureNotice — why a post failed, placed directly under the player.
// The visible line is translated and generic; the engine's raw message stays
// behind a disclosure for support instead of being the first thing a reader
// sees. The provider notices (email not verified, reconnect) sit below it.
//---------------
export function PostFailureNotice({
  status,
  error,
  userNotices,
}: {
  status: string;
  error?: string | null;
  userNotices?: readonly PublishUserNotice[];
}) {
  const { t } = useI18n();
  const hasError = status === 'failed' && typeof error === 'string' && error.length > 0;

  return (
    <>
      {hasError && (
        <div
          data-post-failure
          className="mt-4 rounded-2xl border border-destructive/25 bg-destructive-soft px-4 py-3.5"
        >
          <p className="flex items-start gap-2 text-sm leading-snug font-semibold text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t('posts.cardFailedPermanent')}</span>
          </p>
          {hasError && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-semibold text-destructive underline-offset-4 hover:underline">
                {t('posts.cardDetails')}
              </summary>
              <p className="mt-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-ink-soft">
                {error}
              </p>
            </details>
          )}
          <Button asChild size="sm" className="mt-3">
            <Link href={CREATE_POSTS_HREF}>
              <CalendarPlus className="size-4" aria-hidden />
              {t('posts.cardScheduleAgain')}
            </Link>
          </Button>
        </div>
      )}
      <PublishAccountNotices userNotices={userNotices} />
    </>
  );
}
