'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import AccountCard from '@/components/account-card';
import SocialAccountsSection, { KeyConnectDialog } from '@/components/ui/social-accounts-section';
import {
  useBlueskyAccountsQuery,
} from '@/lib/api';
import { useRumbleAccountsQuery } from '@/lib/social-accounts-queries';
import { useAccountListErrorTelemetry } from '@/lib/account-card-telemetry';
import { useI18n } from '@/lib/i18n/provider';
import { notifyIfSessionExpired } from '@/lib/session-expiry';
import { ProviderBrandIcon } from '@/components/provider-brand-icon';

import { connectedLabel, errorLabel, useDisconnectFlow } from './accounts-section-helpers';


export function BlueskyAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useBlueskyAccountsQuery();
  const flow = useDisconnectFlow('bluesky');
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accounts = query.data?.accounts ?? [];
  const errorAccounts = accounts.filter((account) => account.status === 'error');
  useAccountListErrorTelemetry('bluesky', query.error?.message ?? null);

  const connect = async (): Promise<void> => {
    if (!handle.trim() || !appPassword.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('handle', handle.trim());
      formData.append('appPassword', appPassword);
      const response = await fetch('/api/bluesky-connect', { method: 'POST', body: formData });
      if (!response.ok) {
        notifyIfSessionExpired(response);
        setError(t('accounts.blueskyConnectError'));
        setAppPassword('');
        return;
      }
      setOpen(false);
      setHandle('');
      setAppPassword('');
      void query.refetch();
    } catch {
      setError(t('accounts.blueskyConnectError'));
      setAppPassword('');
    } finally {
      setPending(false);
    }
  };

  return (
    <SocialAccountsSection
      icon={<ProviderBrandIcon provider="bluesky" />}
      label={t('accounts.blueskyLabel')}
      description={t('accounts.blueskyDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      errorLabel={errorAccounts.length > 0 ? errorLabel(t, errorAccounts.length) : null}
      count={accounts.length}
      accounts={accounts.map((account) => <AccountCard key={account.recordId} type="bluesky" name={account.displayName ?? account.handle} thumbnail={account.avatar} error={account.status === 'error'} onReconnect={() => { setHandle(account.handle); setOpen(true); }} showDisconnect onDisconnect={() => flow.onDisconnect(account.did, account.displayName ?? account.handle)} />)}
      isLoading={query.isLoading}
      loadError={query.error?.message ?? null}
      connectLabel={t(accounts.length > 0 ? 'accounts.connectAnother' : 'accounts.connectFirst')}
      connectError={null}
      disconnectError={flow.disconnectError}
      connectDisabled={false}
      retryLabel={t('accounts.tryAgain')}
      onConnect={() => setOpen(true)}
      onRetry={() => void query.refetch()}
      dialog={
        <>
          {flow.dialog}
          {open ? <KeyConnectDialog idPrefix="bluesky" title={t('accounts.blueskyConnectTitle')} hint={t('accounts.blueskyConnectHint')} handleLabel={t('accounts.blueskyHandleLabel')} passwordLabel={t('accounts.blueskyPasswordLabel')} submitLabel={t('accounts.blueskyConnect')} securityHint={t('accounts.blueskySecurityHint')} closeLabel={t('accounts.closeDialog')} handle={handle} appPassword={appPassword} error={error} pending={pending} onHandleChange={setHandle} onPasswordChange={setAppPassword} onSubmit={() => void connect()} onClose={() => setOpen(false)} /> : null}
        </>
      }
    />
  );
}

export function RumbleAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useRumbleAccountsQuery();
  const flow = useDisconnectFlow('rumble');
  const [open, setOpen] = useState(false);
  const [channelId, setChannelId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accounts = query.data?.accounts ?? [];
  const errorAccounts = accounts.filter((account) => account.status === 'error');
  useAccountListErrorTelemetry('rumble', query.error?.message ?? null);

  const connect = async (): Promise<void> => {
    if (!channelId.trim() || !accessToken.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('channelId', channelId.trim());
      formData.append('accessToken', accessToken);
      const response = await fetch('/api/rumble-connect', { method: 'POST', body: formData });
      if (!response.ok) {
        notifyIfSessionExpired(response);
        setError(t('accounts.rumbleConnectError'));
        setAccessToken('');
        return;
      }
      setOpen(false);
      setChannelId('');
      setAccessToken('');
      void query.refetch();
    } catch {
      setError(t('accounts.rumbleConnectError'));
      setAccessToken('');
    } finally {
      setPending(false);
    }
  };

  return (
    <SocialAccountsSection
      icon={<ProviderBrandIcon provider="rumble" />}
      label={t('accounts.rumbleLabel')}
      description={t('accounts.rumbleDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      errorLabel={errorAccounts.length > 0 ? errorLabel(t, errorAccounts.length) : null}
      count={accounts.length}
      accounts={accounts.map((account) => <AccountCard key={account.recordId} type="rumble" name={account.accountName ?? account.providerAccountId} labelOrigin={account.accountName ? 'stored' : 'provider_id'} error={account.status === 'error'} onReconnect={() => { setChannelId(account.providerAccountId); setOpen(true); }} showDisconnect onDisconnect={() => flow.onDisconnect(account.providerAccountId, account.accountName ?? account.providerAccountId)} />)}
      isLoading={query.isLoading}
      loadError={query.error?.message ?? null}
      connectLabel={t(accounts.length > 0 ? 'accounts.connectAnother' : 'accounts.connectFirst')}
      connectError={null}
      disconnectError={flow.disconnectError}
      connectDisabled={false}
      retryLabel={t('accounts.tryAgain')}
      onConnect={() => setOpen(true)}
      onRetry={() => void query.refetch()}
      dialog={
        <>
          {flow.dialog}
          {open ? <KeyConnectDialog idPrefix="rumble" title={t('accounts.rumbleConnectTitle')} hint={t('accounts.rumbleConnectHint')} handleLabel={t('accounts.rumbleChannelLabel')} passwordLabel={t('accounts.rumbleTokenLabel')} submitLabel={t('accounts.rumbleConnect')} securityHint={t('accounts.rumbleSecurityHint')} closeLabel={t('accounts.closeDialog')} handle={channelId} appPassword={accessToken} error={error} pending={pending} onHandleChange={setChannelId} onPasswordChange={setAccessToken} onSubmit={() => void connect()} onClose={() => setOpen(false)} /> : null}
        </>
      }
    />
  );
}
