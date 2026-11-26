'use client';

import type { ReactNode } from 'react';
import AccountCard from '@/components/account-card';
import { PROVIDER_BRANDS, ProviderBrandIcon } from '@/components/provider-brand-icon';
import { useI18n } from '@/lib/i18n/provider';
import { SOCIAL_PROVIDERS, type SocialProvider } from '@/lib/providers/registry';
import type { AccountCardData } from './account-cards';

export interface ProviderAccountGroup {
  provider: SocialProvider;
  accounts: AccountCardData[];
}

export function groupAccountsByProvider(accounts: AccountCardData[]): ProviderAccountGroup[] {
  return SOCIAL_PROVIDERS
    .map((provider) => ({ provider, accounts: accounts.filter((account) => account.type === provider) }))
    .filter((group) => group.accounts.length > 0);
}

export function PostAccountsSection({ accounts }: { accounts: AccountCardData[] }): ReactNode {
  const { t } = useI18n();
  if (accounts.length === 0) return null;
  return (
    <section aria-label={t('posts.accountsLabel')} className="mt-6">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t('posts.accountsLabel')}
      </p>
      <div className="mt-3 space-y-4">
        {groupAccountsByProvider(accounts).map((group) => {
          const label = t(PROVIDER_BRANDS[group.provider].labelKey);
          return (
            <div key={group.provider} role="group" aria-label={label}>
              <div className="flex items-center gap-2.5">
                <ProviderBrandIcon provider={group.provider} />
                <h3 className="text-sm font-semibold text-ink">{label}</h3>
                <span className="text-sm font-medium text-faint">({group.accounts.length})</span>
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {group.accounts.map((account) => (
                  <AccountCard
                    key={`${account.type}:${account.id}`}
                    type={account.type}
                    name={account.name}
                    email={account.email}
                    thumbnail={account.thumbnail}
                    handle={account.handle}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
