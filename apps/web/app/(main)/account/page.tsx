'use client';

import { AccountPanel } from '@/components/ui/account-panel';
import { useI18n } from '@/lib/i18n/provider';

//---------------
// AccountPage — the Perfil/Profile area. On mobile it is reached via
// the header avatar; on desktop the same content lives in the sidebar
// footer. Shows user info, token balance, app version, locale switcher
// and sign-out through the shared AccountPanel.
//---------------
export default function AccountPage() {
  const { t } = useI18n();

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-[#101728]">{t('account.title')}</h1>
        <p className="mt-1 text-[15px] text-[#718096]">{t('account.subtitle')}</p>
      </div>
      <AccountPanel showVersionBadge />
    </div>
  );
}
