'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import AccountCard from '@/components/account-card';
import SocialAccountsSection, { KeyConnectDialog } from '@/components/ui/social-accounts-section';
import { useTelegramAccountsQuery } from '@/lib/social-accounts-queries';
import { useAccountListErrorTelemetry } from '@/lib/account-card-telemetry';
import { useI18n } from '@/lib/i18n/provider';
import { notifyIfSessionExpired } from '@/lib/session-expiry';
import { ProviderIcon } from '@/components/provider-icon';
import { TelegramSetupGuide, telegramConnectErrorKey, type TelegramChatKind } from '@/components/telegram-setup-guide';
import { BrandIcon, connectedLabel, errorLabel, useDisconnectFlow } from './accounts-section-helpers';

export function TelegramAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useTelegramAccountsQuery();
  const flow = useDisconnectFlow('telegram');
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<TelegramChatKind>('channel');
  const [chatId, setChatId] = useState('');
  const [botToken, setBotToken] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accounts = query.data?.accounts ?? [];
  const errorAccounts = accounts.filter((account) => account.status === 'error');
  useAccountListErrorTelemetry('telegram', query.error?.message ?? null);

  const connect = async (): Promise<void> => {
    if (!chatId.trim() || !botToken.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('chatId', chatId.trim());
      formData.append('botToken', botToken);
      formData.append('chatType', kind);
      const response = await fetch('/api/telegram-connect', { method: 'POST', body: formData });
      if (!response.ok) {
        notifyIfSessionExpired(response);
        const body: unknown = await response.json().catch(() => null);
        const code = typeof body === 'object' && body !== null && 'code' in body ? body.code : undefined;
        setError(t(telegramConnectErrorKey(code, kind)));
        setBotToken('');
        return;
      }
      setOpen(false);
      setChatId('');
      setBotToken('');
      void query.refetch();
    } catch {
      setError(t('accounts.telegramConnectError'));
      setBotToken('');
    } finally {
      setPending(false);
    }
  };

  return (
    <SocialAccountsSection
      icon={<BrandIcon className="bg-info-soft text-info"><ProviderIcon provider="telegram" /></BrandIcon>}
      label={t('accounts.telegramLabel')}
      description={t('accounts.telegramDescription')}
      connectedLabel={connectedLabel(t, accounts.length)}
      errorLabel={errorAccounts.length > 0 ? errorLabel(t, errorAccounts.length) : null}
      count={accounts.length}
      accounts={accounts.map((account) => (
        <div key={account.recordId} className="relative">
          <AccountCard
            type="telegram"
            name={account.accountName ?? account.providerAccountId}
            labelOrigin={account.accountName ? 'stored' : 'provider_id'}
            error={account.status === 'error'}
            onReconnect={() => { setChatId(account.providerAccountId); setKind(account.chatType === 'channel' ? 'channel' : 'group'); setOpen(true); }}
            showDisconnect
            onDisconnect={() => flow.onDisconnect(account.providerAccountId, account.accountName ?? account.providerAccountId)}
          />
          <span className="absolute top-2 right-2 rounded border border-info/30 bg-info-soft px-1.5 py-0.5 text-[10px] font-semibold text-info">
            {t(account.chatType === 'channel' ? 'accounts.telegramChannelBadge' : 'accounts.telegramGroupBadge')}
          </span>
        </div>
      ))}
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
          {open ? (
            <KeyConnectDialog
              idPrefix="telegram"
              title={t('accounts.telegramConnectTitle')}
              hint={t('accounts.telegramConnectHint')}
              guide={<TelegramSetupGuide kind={kind} onKindChange={setKind} />}
              handleLabel={t('accounts.telegramChatLabel')}
              passwordLabel={t('accounts.telegramTokenLabel')}
              submitLabel={t('accounts.telegramConnect')}
              securityHint={t('accounts.telegramSecurityHint')}
              closeLabel={t('accounts.closeDialog')}
              handle={chatId}
              appPassword={botToken}
              error={error}
              pending={pending}
              onHandleChange={setChatId}
              onPasswordChange={setBotToken}
              onSubmit={() => void connect()}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </>
      }
    />
  );
}
