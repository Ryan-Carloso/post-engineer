'use client';

import { TrialNoticeView } from '@/components/ui/trial-notice-view';
import { contactWhatsappUrl } from '@/lib/contact-whatsapp';
import { useTrialStatusQuery } from '@/lib/trial-query';

export function TrialNotice() {
  const trial = useTrialStatusQuery();
  if (trial.data === undefined || trial.data === null) return null;
  return <TrialNoticeView status={trial.data} contactUrl={contactWhatsappUrl()} />;
}
