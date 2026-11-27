'use client';

import type { ReactNode } from 'react';
import AccountCard from '@/components/account-card';
import { KeyConnectDialog } from '@/components/ui/social-accounts-section';
import { useBlueskyAccountsQuery } from '@/lib/api';
import { useRumbleAccountsQuery } from '@/lib/social-accounts-queries';
import { useI18n } from '@/lib/i18n/provider';
import { ProviderAccountsSection, storedLabelOrigin, storedName } from './provider-accounts-section';
import { useKeyConnect } from './use-key-connect';

export function BlueskyAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useBlueskyAccountsQuery();
  const keys = useKeyConnect({
    endpoint: '/api/bluesky-connect',
    fields: (handle, appPassword) => ({ handle, appPassword }),
    failureMessage: t('accounts.blueskyConnectError'),
    onConnected: () => void query.refetch(),
  });
  return (
    <ProviderAccountsSection
      provider="bluesky"
      labelKey="accounts.blueskyLabel"
      descriptionKey="accounts.blueskyDescription"
      query={query}
      renderAccount={(account, onDisconnect) => <AccountCard key={account.recordId} type="bluesky" name={account.displayName ?? account.handle} thumbnail={account.avatar} error={account.status === 'error'} onReconnect={() => keys.show(account.handle)} showDisconnect onDisconnect={() => onDisconnect(account.did, account.displayName ?? account.handle)} />}
      onConnect={() => keys.show()}
      dialog={keys.open ? <KeyConnectDialog idPrefix="bluesky" title={t('accounts.blueskyConnectTitle')} hint={t('accounts.blueskyConnectHint')} handleLabel={t('accounts.blueskyHandleLabel')} passwordLabel={t('accounts.blueskyPasswordLabel')} submitLabel={t('accounts.blueskyConnect')} securityHint={t('accounts.blueskySecurityHint')} closeLabel={t('accounts.closeDialog')} {...keys.dialogProps} /> : null}
    />
  );
}

export function RumbleAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useRumbleAccountsQuery();
  const keys = useKeyConnect({
    endpoint: '/api/rumble-connect',
    fields: (channelId, accessToken) => ({ channelId, accessToken }),
    failureMessage: t('accounts.rumbleConnectError'),
    onConnected: () => void query.refetch(),
  });
  return (
    <ProviderAccountsSection
      provider="rumble"
      labelKey="accounts.rumbleLabel"
      descriptionKey="accounts.rumbleDescription"
      query={query}
      renderAccount={(account, onDisconnect) => <AccountCard key={account.recordId} type="rumble" name={storedName(account)} labelOrigin={storedLabelOrigin(account)} error={account.status === 'error'} onReconnect={() => keys.show(account.providerAccountId)} showDisconnect onDisconnect={() => onDisconnect(account.providerAccountId, storedName(account))} />}
      onConnect={() => keys.show()}
      dialog={keys.open ? <KeyConnectDialog idPrefix="rumble" title={t('accounts.rumbleConnectTitle')} hint={t('accounts.rumbleConnectHint')} handleLabel={t('accounts.rumbleChannelLabel')} passwordLabel={t('accounts.rumbleTokenLabel')} submitLabel={t('accounts.rumbleConnect')} securityHint={t('accounts.rumbleSecurityHint')} closeLabel={t('accounts.closeDialog')} {...keys.dialogProps} /> : null}
    />
  );
}
