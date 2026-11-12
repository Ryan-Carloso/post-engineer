'use client';

//---------------
// Credential accounts sections — the manual-token connect sections
// (Bluesky app password, Rumble access token). Extracted from
// app/(main)/accounts/page.tsx (file-size ratchet): the page only
// renders the sections, it does not own them. Brand helpers and the
// disconnect flow live in ./accounts-section-helpers.
//---------------

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
import { ProviderIcon } from '@/components/provider-icon';

import { BrandIcon, connectedLabel, errorLabel, useDisconnectFlow } from './accounts-section-helpers';

function BlueskyIcon(): ReactNode {
  return <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true"><path d="M12 10.8c-1.087-2.114-4.046-6.033-6.798-7.978C2.566 1.01.562 1.098.064 1.855c-.499.757.06 3.708 1.277 5.196.76.93 1.883 2.022 3.19 2.904-1.538-.24-3.02.052-3.585.754-.79.982.294 3.029 2.424 4.573 1.187.86 2.662 1.5 4.082 1.788-1.555.288-3.04 1.017-3.575 2.015-.72 1.343.682 2.72 3.125 3.076 2.1.307 4.653-.355 5.998-1.71 1.345 1.355 3.898 2.017 5.998 1.71 2.443-.356 3.845-1.733 3.125-3.076-.535-.998-2.02-1.727-3.575-2.015 1.42-.288 2.895-.928 4.082-1.788 2.13-1.544 3.214-3.591 2.424-4.573-.565-.702-2.047-.994-3.585-.754 1.307-.882 2.43-1.974 3.19-2.904 1.217-1.488 1.776-4.439 1.277-5.196-.498-.757-2.502-.845-5.138.967C16.046 4.767 13.087 8.686 12 10.8z" /></svg>;
}

//---------------
// Bluesky accounts: one query and a dialog owned by the page.
//---------------

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
        // 401 here means a dead hub session (a rejected Bluesky credential
        // is 422), so it triggers the host-wide session-expiry redirect.
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
      icon={<BrandIcon className="bg-info-soft text-info"><BlueskyIcon /></BrandIcon>}
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

//---------------
// Rumble accounts: manual access token (no OAuth), same two-field
// credential dialog as Bluesky — channel ID + 40-character token.
//---------------

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
        // 401 here means a dead hub session (a rejected Rumble token is
        // 400 — format-only validation), so it triggers the host-wide
        // session-expiry redirect.
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
      icon={<BrandIcon className="bg-muted"><ProviderIcon provider="rumble" /></BrandIcon>}
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
