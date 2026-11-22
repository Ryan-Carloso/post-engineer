'use client';

import { useCallback, useMemo, useState } from 'react';
import { FilterX } from 'lucide-react';
import { useSchedulesQuery, usePersonaListQuery, type ScheduleConfig, type ScheduledSlot } from '@/lib/api';
import { SOCIAL_PROVIDERS, type SocialProvider } from '@/lib/contracts/providers';
import { useSocialAccountsQuery } from '@/lib/social-accounts-queries';
import { useI18n } from '@/lib/i18n/provider';
import { PROVIDER_LABELS, accountOption, type AccountOption, scheduleAccountIds } from '@/lib/account-options';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { resolveSlotAccounts } from './post-card';
import { PostRow } from './post-row';
import type { PersonaPhoto } from './calendar-days';

export type ProviderFilter = 'all' | SocialProvider;

function resolveAccountFilter(accountId: string, provider: ProviderFilter, accounts: AccountOption[]): string {
  if (accountId === 'all') return 'all';
  const account = accounts.find((item) => item.id === accountId);
  if (!account) return 'all';
  if (provider !== 'all' && account.provider !== provider) return 'all';
  return accountId;
}

export interface PostJoins {
  scheduleById: Map<string, ScheduleConfig>;
  personaNameById: Map<string, string>;
  personaPhotoById: Map<string, PersonaPhoto>;
  accountOptions: AccountOption[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function usePostJoins(): PostJoins {
  const schedulesQuery = useSchedulesQuery();
  const personasQuery = usePersonaListQuery();
  const accountsQuery = useSocialAccountsQuery();

  const scheduleById = useMemo(
    () => new Map((schedulesQuery.data ?? []).map((schedule) => [schedule.id, schedule])),
    [schedulesQuery.data],
  );
  const personaNameById = useMemo(
    () => new Map((personasQuery.data ?? []).map((persona) => [persona.id, persona.name])),
    [personasQuery.data],
  );
  const personaPhotoById = useMemo(
    () =>
      new Map(
        (personasQuery.data ?? []).map((persona) => [
          persona.id,
          { avatarUrl: persona.avatarUrl, photoUrl: persona.photoUrl, libraryUrl: persona.libraryUrl, name: persona.name },
        ]),
      ),
    [personasQuery.data],
  );
  const accountOptions: AccountOption[] = useMemo(
    () => (accountsQuery.data?.accounts ?? []).map(accountOption),
    [accountsQuery.data],
  );
  const { refetch: refetchSchedules } = schedulesQuery;
  const { refetch: refetchPersonas } = personasQuery;
  const { refetch: refetchAccounts } = accountsQuery;
  const refetch = useCallback(() => {
    void refetchSchedules();
    void refetchPersonas();
    void refetchAccounts();
  }, [refetchSchedules, refetchPersonas, refetchAccounts]);

  return {
    scheduleById,
    personaNameById,
    personaPhotoById,
    accountOptions,
    isLoading:
      schedulesQuery.isLoading ||
      personasQuery.isLoading ||
      accountsQuery.isLoading,
    isError:
      schedulesQuery.isError ||
      personasQuery.isError ||
      accountsQuery.isError,
    refetch,
  };
}

export interface PostFilters {
  provider: ProviderFilter;
  account: string;
  visibleAccounts: AccountOption[];
  hasActiveFilter: boolean;
  setProvider: (next: ProviderFilter) => void;
  setAccount: (next: string) => void;
  clear: () => void;
  passes: (slot: ScheduledSlot) => boolean;
}

export function usePostFilters(joins: PostJoins): PostFilters {
  const { scheduleById, accountOptions } = joins;
  const [provider, setProviderState] = useState<ProviderFilter>('all');
  const [accountState, setAccount] = useState<string>('all');
  const account = useMemo(
    () => resolveAccountFilter(accountState, provider, accountOptions),
    [accountState, provider, accountOptions],
  );
  const visibleAccounts = useMemo(
    () => (provider === 'all' ? accountOptions : accountOptions.filter((item) => item.provider === provider)),
    [accountOptions, provider],
  );
  const setProvider = useCallback(
    (next: ProviderFilter) => {
      setProviderState(next);
      setAccount((current) => resolveAccountFilter(current, next, accountOptions));
    },
    [accountOptions],
  );
  const passes = useCallback(
    (slot: ScheduledSlot): boolean => {
      const schedule = scheduleById.get(slot.scheduleId);
      if (!schedule) return false;
      if (provider !== 'all' && !schedule.providers.includes(provider)) return false;
      if (account !== 'all' && !new Set(scheduleAccountIds(schedule)).has(account)) return false;
      return true;
    },
    [scheduleById, provider, account],
  );
  const clear = useCallback(() => {
    setProviderState('all');
    setAccount('all');
  }, []);
  const hasActiveFilter = provider !== 'all' || account !== 'all';
  return { provider, account, visibleAccounts, hasActiveFilter, setProvider, setAccount, clear, passes };
}

const TRIGGER_CLASS =
  'h-10 w-full rounded-xl border-input bg-card px-3 text-sm font-medium text-primary sm:w-48';
const SELECT_DISABLED_CLASS = 'border-line bg-sunken/90 text-muted-foreground saturate-50';
const SELECT_CHEVRON_HIDDEN_CLASS = '[&>svg]:hidden';
const SELECT_ACTIVE_CLASS = 'border-primary bg-info-soft ring-1 ring-primary';
const LABEL_CLASS = 'flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted-foreground';

export function PostFiltersBar({
  filters,
  disabled = false,
  unavailable = false,
}: {
  filters: PostFilters;
  disabled?: boolean;
  unavailable?: boolean;
}) {
  const { t } = useI18n();
  const inert = disabled || unavailable;
  return (
    <div
      className={cn(
        'mt-3 grid grid-cols-2 gap-3 sm:mt-4 sm:flex sm:flex-wrap sm:items-end',
        unavailable && 'pointer-events-none',
      )}
      aria-disabled={unavailable ? true : undefined}
    >
      <div className={LABEL_CLASS}>
        <span>{t('posts.filterProvider')}</span>
        <Select
          value={filters.provider}
          disabled={inert}
          onValueChange={(value) => {
            const next = SOCIAL_PROVIDERS.find((item) => item === value) ?? 'all';
            filters.setProvider(next);
          }}
        >
          <SelectTrigger
            aria-label={t('posts.filterProvider')}
            className={cn(
              TRIGGER_CLASS,
              filters.provider !== 'all' && !unavailable && SELECT_ACTIVE_CLASS,
              inert && SELECT_DISABLED_CLASS,
              inert && SELECT_CHEVRON_HIDDEN_CLASS,
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('posts.allProviders')}</SelectItem>
            {SOCIAL_PROVIDERS.map((item) => (
              <SelectItem key={item} value={item}>
                {PROVIDER_LABELS[item]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className={LABEL_CLASS}>
        <span>{t('posts.filterAccount')}</span>
        <Select value={filters.account} disabled={inert} onValueChange={(value) => filters.setAccount(value)}>
          <SelectTrigger
            aria-label={t('posts.filterAccount')}
            className={cn(
              TRIGGER_CLASS,
              filters.account !== 'all' && !unavailable && SELECT_ACTIVE_CLASS,
              inert && SELECT_DISABLED_CLASS,
              inert && SELECT_CHEVRON_HIDDEN_CLASS,
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('posts.allAccounts')}</SelectItem>
            {filters.visibleAccounts.map((item) => (
              <SelectItem key={`${item.provider}:${item.id}`} value={item.id}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {filters.hasActiveFilter && (
        <Button type="button" variant="ghost" className="col-span-2 h-10 gap-1.5 justify-self-start text-primary hover:bg-sunken hover:text-primary" onClick={filters.clear}>
          <FilterX aria-hidden />
          {t('posts.clearFilters')}
        </Button>
      )}
    </div>
  );
}

export function SlotCard({ slot, joins, timeOnly = false }: { slot: ScheduledSlot; joins: PostJoins; timeOnly?: boolean }) {
  const { t, locale } = useI18n();
  const schedule = joins.scheduleById.get(slot.scheduleId);
  const personaId = schedule?.personaId ?? null;
  const personaName = personaId === null ? t('posts.noPersona') : joins.personaNameById.get(personaId) ?? t('posts.personaFallback');
  return (
    <PostRow
      slot={slot}
      personaName={personaName}
      accounts={resolveSlotAccounts(schedule, joins.accountOptions)}
      locale={locale}
      timeOnly={timeOnly}
    />
  );
}
