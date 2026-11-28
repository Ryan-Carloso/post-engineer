'use client';

import { AccessNoticeView } from '@/components/ui/access-notice-view';
import { DISCORD_INVITE_URL, whatsappUrl } from '@/lib/public-links';
import { useAccessQuery } from '@/lib/access-query';

export function AccessNotice() {
  const access = useAccessQuery();
  if (access.data === undefined || access.data === null) return null;
  return <AccessNoticeView status={access.data} contactUrl={whatsappUrl()} discordUrl={DISCORD_INVITE_URL} />;
}
