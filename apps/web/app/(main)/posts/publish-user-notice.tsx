'use client';

import { useI18n } from '@/lib/i18n/provider';
import { providerLabel, type PublishUserNotice } from '@/lib/publish-user-notice';

export function PublishAccountNotices({
  status,
  error,
  userNotices,
  compact = false,
}: {
  status: string;
  error?: string | null;
  userNotices?: readonly PublishUserNotice[];
  compact?: boolean;
}) {
  const { t } = useI18n();
  const tone = compact ? 'mt-3 text-xs text-destructive' : 'mt-6 text-sm text-destructive';
  return (
    <>
      {(userNotices ?? []).map((notice) => (
        <p key={`${notice.provider}:${notice.accountId}:${notice.code}`} className={tone} role="alert">
          {noticeText(t, notice)}
        </p>
      ))}
      {status === 'failed' && error ? <p className={tone}>{error}</p> : null}
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
