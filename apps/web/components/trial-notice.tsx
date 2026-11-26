'use client';

import { TrialNoticeView } from '@/components/ui/trial-notice-view';
import { CONTACT_WHATSAPP_URL } from '@/lib/contact';
import { useTrialStatusQuery } from '@/lib/trial-query';

export function TrialNotice() {
  const trial = useTrialStatusQuery();
  if (trial.data === undefined || trial.data === null) return null;
  return <TrialNoticeView status={trial.data} contactUrl={CONTACT_WHATSAPP_URL} />;
}
