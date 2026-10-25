'use client';

import { useI18n } from '@/lib/i18n/provider';

export function AvatarDisabledBanner({ warnings }: { warnings?: string[] | null }) {
  const { t } = useI18n();
  if (!Array.isArray(warnings) || !warnings.includes('avatar_disabled')) return null;
  return (
    <p
      role="status"
      data-testid="avatar-disabled-warning"
      className="mt-6 rounded-xl bg-[#fff8e0] p-3 text-sm text-[#8a6100]"
    >
      {t('posts.avatarDisabledWarning')}
    </p>
  );
}
