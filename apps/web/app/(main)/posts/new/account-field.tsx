'use client';

import Link from 'next/link';
import { Users } from 'lucide-react';

import AccountCard from '@/components/account-card';
import { ProviderIcon } from '@/components/provider-icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineFieldError } from '@/components/ui/form-field';
import { PROVIDER_LABELS, type AccountOption } from '@/lib/account-options';
import { IMAGE_PROVIDERS, type SocialProvider } from '@/lib/contracts/providers';
import { useI18n } from '@/lib/i18n/provider';

export type AccountsEmptyReason = 'none' | 'image' | 'persona' | 'disconnected';

export function AccountField({
  accounts,
  providers,
  selected,
  loading,
  error,
  issue,
  disabled,
  onToggle,
  emptyReason,
}: {
  accounts: AccountOption[];
  providers: readonly SocialProvider[];
  selected: Partial<Record<SocialProvider, string[]>>;
  loading: boolean;
  error: boolean;
  issue: string | null;
  disabled: boolean;
  onToggle: (provider: SocialProvider, id: string) => void;
  emptyReason: AccountsEmptyReason;
}) {
  const { t } = useI18n();
  const empty = {
    none: { title: t('composer.accountsEmptyTitle'), description: t('composer.accountsEmptyHint') },
    image: {
      title: t('composer.accountsImageEmptyTitle'),
      description: t('composer.accountsImageHint', {
        providers: IMAGE_PROVIDERS.map((provider) => PROVIDER_LABELS[provider]).join(', '),
      }),
    },
    persona: { title: t('composer.accountsBoundEmptyTitle'), description: t('composer.accountsBoundEmptyDescription') },
    disconnected: {
      title: t('composer.accountsDisconnectedEmptyTitle'),
      description: t('composer.accountsDisconnectedEmptyDescription'),
    },
  }[emptyReason];
  const groups = providers
    .map((provider) => ({
      provider,
      accounts: accounts.filter((account) => account.provider === provider),
    }))
    .filter((group) => group.accounts.length > 0);
  const total = groups.reduce((sum, group) => sum + group.accounts.length, 0);

  return (
    <section className="rounded-2xl border border-line bg-card p-5 shadow-sm sm:p-6" data-testid="composer-accounts">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{t('composer.accountsLabel')}</h2>
        <p className="text-xs text-muted-text">{t('composer.accountsHint')}</p>
      </div>

      {loading ? (
        <div className="mt-4 space-y-3" aria-busy="true">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-16 animate-pulse rounded-xl bg-sunken" />
          ))}
        </div>
      ) : error ? (
        <InlineFieldError message={t('composer.accountsLoadError')} />
      ) : total === 0 ? (
        <div className="mt-4">
          <EmptyState
            compact
            icon={Users}
            title={empty.title}
            description={empty.description}
            action={
              emptyReason !== 'persona' ? (
                <Button asChild size="sm" variant="outline">
                  <Link href="/accounts">{t('composer.accountsEmptyAction')}</Link>
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          {groups.map(({ provider, accounts: providerAccounts }) => (
            <div key={provider}>
              <div className="flex items-center gap-2">
                <ProviderIcon provider={provider} />
                <p className="text-sm font-semibold text-ink">{PROVIDER_LABELS[provider]}</p>
                <Badge variant="secondary" className="text-[11px]">
                  {providerAccounts.length}
                </Badge>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-3">
                {providerAccounts.map((account) => (
                  <AccountCard
                    key={`${provider}:${account.id}`}
                    type={provider}
                    name={account.label}
                    selected={(selected[provider] ?? []).includes(account.id)}
                    onSelect={disabled ? undefined : () => onToggle(provider, account.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {issue !== null && <InlineFieldError message={issue} />}
    </section>
  );
}
