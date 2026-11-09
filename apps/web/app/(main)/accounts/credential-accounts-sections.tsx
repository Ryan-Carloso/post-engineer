'use client';

//---------------
// Credential accounts sections — the manual-token connect sections
// (Bluesky app password, Rumble access token) plus the disconnect flow
// and brand helpers every accounts section shares. Extracted from
// app/(main)/accounts/page.tsx (file-size ratchet): the page only
// renders the sections, it does not own them.
//---------------

import { useState } from 'react';
import type { ReactNode } from 'react';
import AccountCard from '@/components/account-card';
import DisconnectAccountDialog from '@/components/ui/disconnect-account-dialog';
import SocialAccountsSection, { CredentialConnectDialog } from '@/components/ui/social-accounts-section';
import {
  useBlueskyAccountsQuery,
  useDisconnectAccountMutation,
  useRumbleAccountsQuery,
  type DisconnectableProvider,
  type DisconnectAccountResult,
} from '@/lib/api';
import { useAccountListErrorTelemetry, reportAccountDisconnectFailed } from '@/lib/account-card-telemetry';
import { useI18n } from '@/lib/i18n/provider';
import { notifyIfSessionExpired } from '@/lib/session-expiry';
import { ProviderIcon } from '@/components/provider-icon';

//---------------
// Brand mark and the translated connected-count.
//---------------

export function BrandIcon({ className, children }: { className: string; children: ReactNode }): ReactNode {
  return <span className={`flex size-9 items-center justify-center rounded-lg ${className} [&>svg]:size-5`}>{children}</span>;
}

export function connectedLabel(t: ReturnType<typeof useI18n>['t'], count: number): string {
  return t(count === 1 ? 'accounts.accountConnected' : 'accounts.accountsConnected', { count });
}

//---------------
// useDisconnectFlow — one dialog-backed disconnect flow per provider
// section. The trash button on the card opens the confirmation dialog;
// confirming runs the disconnect, and a throw or success:false is shown
// in the section and sent to PostHog.
//---------------

interface PendingDisconnect {
  providerAccountId: string;
  label: string;
}

export function useDisconnectFlow(provider: DisconnectableProvider): {
  disconnectError: string | null;
  onDisconnect: (providerAccountId: string, label: string) => void;
  dialog: ReactNode;
} {
  const { t } = useI18n();
  const disconnect = useDisconnectAccountMutation(provider);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDisconnect | null>(null);

  // Opening the dialog clears a previous section error, so the fresh
  // attempt starts from a clean panel.
  const onDisconnect = (providerAccountId: string, label: string): void => {
    setDisconnectError(null);
    setPending({ providerAccountId, label });
  };

  const confirm = (): void => {
    if (pending === null || disconnect.isPending) return;
    void handleDisconnect(t, disconnect, provider, pending.providerAccountId, setDisconnectError)
      .finally(() => setPending(null));
  };

  const dialog = (
    <DisconnectAccountDialog
      open={pending !== null}
      onClose={() => { if (!disconnect.isPending) setPending(null); }}
      onConfirm={confirm}
      pending={disconnect.isPending}
      accountName={pending?.label ?? ''}
      title={t('accounts.disconnectQuestion')}
      body={t('accounts.disconnectBody')}
      cancelLabel={t('accounts.disconnectCancel')}
      confirmLabel={t('accounts.disconnectConfirm')}
    />
  );

  return { disconnectError, onDisconnect, dialog };
}

//---------------
// handleDisconnect — runs the disconnect for one account. A throw or
// success:false is shown in the section and sent to PostHog.
//---------------

async function handleDisconnect(
  t: ReturnType<typeof useI18n>['t'],
  disconnect: { mutateAsync: (input: { providerAccountId: string }) => Promise<DisconnectAccountResult> },
  provider: DisconnectableProvider,
  providerAccountId: string,
  onError: (message: string) => void,
): Promise<void> {
  try {
    const result = await disconnect.mutateAsync({ providerAccountId });
    if (!result.success) {
      reportAccountDisconnectFailed(provider, 'rejected');
      onError(t('accounts.disconnectError'));
    }
  } catch {
    reportAccountDisconnectFailed(provider, 'threw');
    onError(t('accounts.disconnectError'));
  }
}

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
      count={accounts.length}
      accounts={accounts.map((account) => <AccountCard key={account.recordId} type="bluesky" name={account.displayName ?? account.handle} thumbnail={account.avatar} showDisconnect onDisconnect={() => flow.onDisconnect(account.did, account.displayName ?? account.handle)} />)}
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
          {open ? <CredentialConnectDialog idPrefix="bluesky" title={t('accounts.blueskyConnectTitle')} hint={t('accounts.blueskyConnectHint')} handleLabel={t('accounts.blueskyHandleLabel')} passwordLabel={t('accounts.blueskyPasswordLabel')} submitLabel={t('accounts.blueskyConnect')} securityHint={t('accounts.blueskySecurityHint')} closeLabel={t('accounts.closeDialog')} handle={handle} appPassword={appPassword} error={error} pending={pending} onHandleChange={setHandle} onPasswordChange={setAppPassword} onSubmit={() => void connect()} onClose={() => setOpen(false)} /> : null}
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
      count={accounts.length}
      accounts={accounts.map((account) => <AccountCard key={account.recordId} type="rumble" name={account.accountName ?? account.providerAccountId} labelOrigin={account.accountName ? 'stored' : 'provider_id'} showDisconnect onDisconnect={() => flow.onDisconnect(account.providerAccountId, account.accountName ?? account.providerAccountId)} />)}
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
          {open ? <CredentialConnectDialog idPrefix="rumble" title={t('accounts.rumbleConnectTitle')} hint={t('accounts.rumbleConnectHint')} handleLabel={t('accounts.rumbleChannelLabel')} passwordLabel={t('accounts.rumbleTokenLabel')} submitLabel={t('accounts.rumbleConnect')} securityHint={t('accounts.rumbleSecurityHint')} closeLabel={t('accounts.closeDialog')} handle={channelId} appPassword={accessToken} error={error} pending={pending} onHandleChange={setChannelId} onPasswordChange={setAccessToken} onSubmit={() => void connect()} onClose={() => setOpen(false)} /> : null}
        </>
      }
    />
  );
}
