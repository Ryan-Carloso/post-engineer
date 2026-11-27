'use client';

import type { ReactNode } from 'react';
import SocialAccountsSection from '@/components/ui/social-accounts-section';
import { ProviderBrandIcon } from '@/components/provider-brand-icon';
import { useAccountListErrorTelemetry } from '@/lib/account-card-telemetry';
import type { SocialProvider } from '@/lib/contracts/providers';
import type { TranslationKey } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/provider';
import { connectedLabel, errorLabel, useDisconnectFlow } from './accounts-section-helpers';

interface AccountListQuery<Account> {
  data?: { accounts: Account[] };
  isLoading: boolean;
  error: { message: string } | null;
  refetch: () => unknown;
}

export interface StoredNameAccount {
  recordId: string;
  providerAccountId: string;
  accountName?: string | null;
}

export function storedName(account: StoredNameAccount): string {
  return account.accountName ?? account.providerAccountId;
}

export function storedLabelOrigin(account: StoredNameAccount): 'stored' | 'provider_id' {
  return account.accountName ? 'stored' : 'provider_id';
}

interface ProviderAccountsSectionProps<Account> {
  provider: SocialProvider;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  query: AccountListQuery<Account>;
  renderAccount: (account: Account, onDisconnect: (providerAccountId: string, label: string) => void) => ReactNode;
  onConnect: () => void;
  connectError?: string | null;
  connectDisabled?: boolean;
  dialog?: ReactNode;
}

export function ProviderAccountsSection<Account extends { status?: string }>({
  provider,
  labelKey,
  descriptionKey,
  query,
  renderAccount,
  onConnect,
  connectError = null,
  connectDisabled = false,
  dialog = null,
}: ProviderAccountsSectionProps<Account>): ReactNode {
  const { t } = useI18n();
  const flow = useDisconnectFlow(provider);
  const accounts = query.data?.accounts ?? [];
  const errorCount = accounts.filter((account) => account.status === 'error').length;
  useAccountListErrorTelemetry(provider, query.error?.message ?? null);
  return (
    <SocialAccountsSection
      icon={<ProviderBrandIcon provider={provider} />}
      label={t(labelKey)}
      description={t(descriptionKey)}
      connectedLabel={connectedLabel(t, accounts.length)}
      errorLabel={errorCount > 0 ? errorLabel(t, errorCount) : null}
      count={accounts.length}
      accounts={accounts.map((account) => renderAccount(account, flow.onDisconnect))}
      isLoading={query.isLoading}
      loadError={query.error?.message ?? null}
      connectLabel={t(accounts.length > 0 ? 'accounts.connectAnother' : 'accounts.connectFirst')}
      connectError={connectError}
      disconnectError={flow.disconnectError}
      connectDisabled={connectDisabled}
      retryLabel={t('accounts.tryAgain')}
      onConnect={onConnect}
      onRetry={() => void query.refetch()}
      dialog={<>{flow.dialog}{dialog}</>}
    />
  );
}
