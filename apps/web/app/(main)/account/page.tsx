'use client';

import { AccountPanel } from '@/components/ui/account-panel';
import { useI18n } from '@/lib/i18n/provider';

export default function AccountPage() {
  const { t } = useI18n();

  return (
    <div data-testid="account-page" className="mx-auto w-full max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-ink">{t('account.title')}</h1>
        <p className="mt-1 text-[15px] text-muted-text">{t('account.subtitle')}</p>
      </div>
      <AccountPanel showVersionBadge />
    </div>
  );
}
