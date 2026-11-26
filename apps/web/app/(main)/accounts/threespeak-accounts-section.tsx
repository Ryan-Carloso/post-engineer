'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import AccountCard from '@/components/account-card';
import SocialAccountsSection from '@/components/ui/social-accounts-section';
import { KeyConnectDialog } from '@/components/ui/social-accounts-section';
import { useThreespeakAccountsQuery } from '@/lib/api';
import { useAccountListErrorTelemetry } from '@/lib/account-card-telemetry';
import { ERROR_CODES } from '@/lib/error-codes';
import { useI18n } from '@/lib/i18n/provider';
import { notifyIfSessionExpired } from '@/lib/session-expiry';
import { ProviderBrandIcon } from '@/components/provider-brand-icon';
import { connectedLabel, errorLabel, useDisconnectFlow } from './accounts-section-helpers';

export function ThreespeakAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useThreespeakAccountsQuery();
  const flow = useDisconnectFlow('3speak');
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accounts = query.data?.accounts ?? [];
  const errorAccounts = accounts.filter((account) => account.status === 'error');
  useAccountListErrorTelemetry('3speak', query.error?.message ?? null);

  const connect = async (): Promise<void> => {
    if (!handle.trim() || !appPassword.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('username', handle.trim());
      formData.append('postingKey', appPassword);
      const response = await fetch('/api/threespeak-connect', { method: 'POST', body: formData });
      if (!response.ok) {
        notifyIfSessionExpired(response);
        const body: unknown = await response.json().catch(() => null);
        const code = (body as { code?: unknown } | null)?.code;
        setError(
          code === ERROR_CODES.THREESPEAK_CREDENTIAL_REJECTED
            ? t('accounts.threespeakCredentialRejected')
            : t('accounts.threespeakConnectError'),
        );
        setAppPassword('');
        return;
      }
      setOpen(false);
      setHandle('');
      setAppPassword('');
      void query.refetch();
    } catch {
      setError(t('accounts.threespeakConnectError'));
      setAppPassword('');
    } finally {
      setPending(false);
    }
  };

  return (
    <SocialAccountsSection
      icon={<ProviderBrandIcon provider="3speak" />}
      label={t('accounts.threespeakLabel')}
      description={t('accounts.threespeakDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      errorLabel={errorAccounts.length > 0 ? errorLabel(t, errorAccounts.length) : null}
      count={accounts.length}
      accounts={accounts.map((account) => <AccountCard key={account.recordId} type="3speak" name={account.accountName ?? account.providerAccountId} labelOrigin={account.accountName ? 'stored' : 'provider_id'} error={account.status === 'error'} onReconnect={() => { setHandle(account.providerAccountId); setOpen(true); }} showDisconnect onDisconnect={() => flow.onDisconnect(account.providerAccountId, account.accountName ?? account.providerAccountId)} />)}
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
          {open ? <KeyConnectDialog idPrefix="threespeak" title={t('accounts.threespeakConnectTitle')} hint={t('accounts.threespeakConnectHint')} handleLabel={t('accounts.threespeakHandleLabel')} passwordLabel={t('accounts.threespeakPasswordLabel')} submitLabel={t('accounts.threespeakConnect')} securityHint={t('accounts.threespeakSecurityHint')} closeLabel={t('accounts.closeDialog')} handle={handle} appPassword={appPassword} error={error} pending={pending} onHandleChange={setHandle} onPasswordChange={setAppPassword} onSubmit={() => void connect()} onClose={() => setOpen(false)} /> : null}
        </>
      }
    />
  );
}
