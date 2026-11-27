'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import AccountCard from '@/components/account-card';
import { KeyConnectDialog } from '@/components/ui/social-accounts-section';
import { useTelegramAccountsQuery } from '@/lib/social-accounts-queries';
import { useI18n } from '@/lib/i18n/provider';
import { TelegramSetupGuide, telegramConnectErrorKey, type TelegramChatKind } from '@/components/telegram-setup-guide';
import { ProviderAccountsSection, storedLabelOrigin, storedName } from './provider-accounts-section';
import { useKeyConnect } from './use-key-connect';

export function TelegramAccountsSection(): ReactNode {
  const { t } = useI18n();
  const query = useTelegramAccountsQuery();
  const [kind, setKind] = useState<TelegramChatKind>('channel');
  const keys = useKeyConnect({
    endpoint: '/api/telegram-connect',
    fields: (chatId, botToken) => ({ chatId, botToken, chatType: kind }),
    failureMessage: t('accounts.telegramConnectError'),
    rejectedMessage: (code) => t(telegramConnectErrorKey(code, kind)),
    onConnected: () => void query.refetch(),
  });
  return (
    <ProviderAccountsSection
      provider="telegram"
      labelKey="accounts.telegramLabel"
      descriptionKey="accounts.telegramDescription"
      query={query}
      renderAccount={(account, onDisconnect) => (
        <div key={account.recordId} className="relative">
          <AccountCard
            type="telegram"
            name={storedName(account)}
            labelOrigin={storedLabelOrigin(account)}
            error={account.status === 'error'}
            onReconnect={() => { setKind(account.chatType === 'channel' ? 'channel' : 'group'); keys.show(account.providerAccountId); }}
            showDisconnect
            onDisconnect={() => onDisconnect(account.providerAccountId, storedName(account))}
          />
          <span className="absolute top-2 right-2 rounded border border-info/30 bg-info-soft px-1.5 py-0.5 text-[10px] font-semibold text-info">
            {t(account.chatType === 'channel' ? 'accounts.telegramChannelBadge' : 'accounts.telegramGroupBadge')}
          </span>
        </div>
      )}
      onConnect={() => keys.show()}
      dialog={keys.open ? (
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
          {...keys.dialogProps}
        />
      ) : null}
    />
  );
}
