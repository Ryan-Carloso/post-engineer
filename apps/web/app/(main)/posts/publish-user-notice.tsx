'use client';

import { useI18n } from '@/lib/i18n/provider';
import { providerLabel, type PublishUserNotice } from '@/lib/publish-user-notice';

export function PublishAccountNotices({
  userNotices,
  compact = false,
}: {
  userNotices?: readonly PublishUserNotice[];
  compact?: boolean;
}) {
  const { t } = useI18n();
  // compact: the line sits under a dense post row, not under a card block.
  const tone = compact ? 'mt-2 text-xs text-destructive' : 'mt-6 text-sm text-destructive';
  return (
    <>
      {(userNotices ?? []).map((notice) => (
        <p key={`${notice.provider}:${notice.accountId}:${notice.code}`} className={tone} role="alert">
          {noticeText(t, notice)}
        </p>
      ))}
    </>
  );
}

function noticeText(
  t: (key: 'posts.userNoticeEmail' | 'posts.userNoticeReconnect', vars: { provider: string }) => string,
  notice: PublishUserNotice,
): string {
  const provider = providerLabel(notice.provider);
  if (notice.code === 'email_not_verified') return t('posts.userNoticeEmail', { provider });
  if (notice.code === 'token_expired' || notice.code === 'token_missing' || notice.code === 'disconnected') {
    return t('posts.userNoticeReconnect', { provider });
  }
  return notice.notice;
}
