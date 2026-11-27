'use client';

import type { ReactNode } from 'react';
import AccountCard from '@/components/account-card';
import { KeyConnectDialog } from '@/components/ui/social-accounts-section';
import { useThreespeakAccountsQuery } from '@/lib/api';
import { ERROR_CODES } from '@/lib/error-codes';
import { useI18n } from '@/lib/i18n/provider';
import { ProviderAccountsSection, storedLabelOrigin, storedName } from './provider-accounts-section';
import { useKeyConnect } from './use-key-connect';

export function ThreespeakAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useThreespeakAccountsQuery();
  const keys = useKeyConnect({
    endpoint: '/api/threespeak-connect',
    fields: (username, postingKey) => ({ username, postingKey }),
    failureMessage: t('accounts.threespeakConnectError'),
    rejectedMessage: (code) => code === ERROR_CODES.THREESPEAK_CREDENTIAL_REJECTED
      ? t('accounts.threespeakCredentialRejected')
      : t('accounts.threespeakConnectError'),
    onConnected: () => void query.refetch(),
  });
  return (
    <ProviderAccountsSection
      provider="3speak"
      labelKey="accounts.threespeakLabel"
      descriptionKey="accounts.threespeakDescription"
      query={query}
      renderAccount={(account, onDisconnect) => <AccountCard key={account.recordId} type="3speak" name={storedName(account)} labelOrigin={storedLabelOrigin(account)} error={account.status === 'error'} onReconnect={() => keys.show(account.providerAccountId)} showDisconnect onDisconnect={() => onDisconnect(account.providerAccountId, storedName(account))} />}
      onConnect={() => keys.show()}
      dialog={keys.open ? <KeyConnectDialog idPrefix="threespeak" title={t('accounts.threespeakConnectTitle')} hint={t('accounts.threespeakConnectHint')} handleLabel={t('accounts.threespeakHandleLabel')} passwordLabel={t('accounts.threespeakPasswordLabel')} submitLabel={t('accounts.threespeakConnect')} securityHint={t('accounts.threespeakSecurityHint')} closeLabel={t('accounts.closeDialog')} {...keys.dialogProps} /> : null}
    />
  );
}
