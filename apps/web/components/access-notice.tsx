'use client';

import { AccessNoticeView } from '@/components/ui/access-notice-view';
import { DISCORD_INVITE_URL, GITHUB_URL, whatsappUrl } from '@/lib/public-links';
import { useAccessQuery } from '@/lib/access-query';
import { useI18n } from '@/lib/i18n/provider';

export function AccessNotice() {
  const access = useAccessQuery();
  const { t } = useI18n();
  if (access.data === undefined || access.data === null) return null;
  const contactUrl = access.data.reason === 'beta' ? whatsappUrl(t('landing.pricingWhatsappBeta')) : whatsappUrl();
  return (
    <AccessNoticeView status={access.data} contactUrl={contactUrl} discordUrl={DISCORD_INVITE_URL} githubUrl={GITHUB_URL} />
  );
}
