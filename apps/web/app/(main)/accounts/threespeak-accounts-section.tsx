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
import { ProviderIcon } from '@/components/provider-icon';
import { BrandIcon, connectedLabel, useDisconnectFlow } from './accounts-section-helpers';

// 3Speak accounts: one query and a key dialog owned by the page — same
// shape as Bluesky (no OAuth: a Hive username plus its posting key).
// A rejected key is 422, not 401; only a dead hub session is 401 here.
//---------------

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
        // 401 here means a dead hub session (a rejected Hive posting key
        // is 422), so it triggers the host-wide session-expiry redirect.
        notifyIfSessionExpired(response);
        // A rejected credential is 422 THREESPEAK_CREDENTIAL_REJECTED: name
        // it, so the user knows the username/key pair is what 3Speak refused.
        // (notifyIfSessionExpired reads only the status, so the body is
        // still unread here.)
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
      icon={<BrandIcon className="bg-muted"><ProviderIcon provider="3speak" /></BrandIcon>}
      label={t('accounts.threespeakLabel')}
      description={t('accounts.threespeakDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      count={accounts.length}
      accounts={accounts.map((account) => <AccountCard key={account.recordId} type="3speak" name={account.accountName ?? account.providerAccountId} labelOrigin={account.accountName ? 'stored' : 'provider_id'} showDisconnect onDisconnect={() => flow.onDisconnect(account.providerAccountId, account.accountName ?? account.providerAccountId)} />)}
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
