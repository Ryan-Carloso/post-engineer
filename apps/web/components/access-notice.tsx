'use client';

import { AccessNoticeView } from '@/components/ui/access-notice-view';
import { CONTACT_WHATSAPP_URL } from '@/lib/contact';
import { useAccessQuery } from '@/lib/access-query';

export function AccessNotice() {
  const access = useAccessQuery();
  if (access.data === undefined || access.data === null) return null;
  return <AccessNoticeView status={access.data} contactUrl={CONTACT_WHATSAPP_URL} />;
}
