'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  useSchedulesQuery,
  usePersonaListQuery,
  useYouTubeAccountsQuery,
  useInstagramAccountsQuery,
  useLinkedinAccountsQuery,
  useThreadsAccountsQuery,
  useFacebookAccountsQuery,
  useBlueskyAccountsQuery,
  type ScheduleConfig,
  type ScheduledSlot,
} from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';
import { PROVIDER_LABELS, accountOption, type AccountOption, scheduleAccountIds } from '@/lib/account-options';
import { PostCard, resolveSlotAccounts } from './post-card';

//---------------
// Shared by the posts calendar (/posts) and the post history
// (/posts/history): the joins every slot card needs (schedule, persona,
// publishing accounts), the network/account filters and the card itself.
//---------------

export type ProviderFilter = 'all' | 'youtube' | 'instagram' | 'linkedin' | 'bluesky' | 'threads' | 'facebook';

const PROVIDERS: Exclude<ProviderFilter, 'all'>[] = ['youtube', 'instagram', 'linkedin', 'bluesky', 'threads', 'facebook'];

//---------------
// resolveAccountFilter — a selected account only stays applied when it
// belongs to the network filter ('all' keeps any account). Unknown ids
// and incompatible networks fall back to 'all'.
//---------------
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
  accountOptions: AccountOption[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function usePostJoins(): PostJoins {
  const schedulesQuery = useSchedulesQuery();
  const personasQuery = usePersonaListQuery();
  const youtubeQuery = useYouTubeAccountsQuery();
  const instagramQuery = useInstagramAccountsQuery();
  const linkedinQuery = useLinkedinAccountsQuery();
  const blueskyQuery = useBlueskyAccountsQuery();
  const threadsQuery = useThreadsAccountsQuery();
  const facebookQuery = useFacebookAccountsQuery();

  const scheduleById = useMemo(
    () => new Map((schedulesQuery.data ?? []).map((schedule) => [schedule.id, schedule])),
    [schedulesQuery.data],
  );
  const personaNameById = useMemo(
    () => new Map((personasQuery.data ?? []).map((persona) => [persona.id, persona.name])),
    [personasQuery.data],
  );
  const accountOptions: AccountOption[] = useMemo(
    () => [
      ...(youtubeQuery.data?.accounts ?? []).map(accountOption),
      ...(instagramQuery.data?.accounts ?? []).map(accountOption),
      ...(linkedinQuery.data?.accounts ?? []).map(accountOption),
      ...(blueskyQuery.data?.accounts ?? []).map(accountOption),
      ...(threadsQuery.data?.accounts ?? []).map(accountOption),
      ...(facebookQuery.data?.accounts ?? []).map(accountOption),
    ],
    [youtubeQuery.data, instagramQuery.data, linkedinQuery.data, blueskyQuery.data, threadsQuery.data, facebookQuery.data],
  );
  const { refetch: refetchSchedules } = schedulesQuery;
  const { refetch: refetchPersonas } = personasQuery;
  const { refetch: refetchYoutube } = youtubeQuery;
  const { refetch: refetchInstagram } = instagramQuery;
  const { refetch: refetchLinkedin } = linkedinQuery;
  const { refetch: refetchBluesky } = blueskyQuery;
  const { refetch: refetchThreads } = threadsQuery;
  const { refetch: refetchFacebook } = facebookQuery;
  const refetch = useCallback(() => {
    void refetchSchedules();
    void refetchPersonas();
    void refetchYoutube();
    void refetchInstagram();
    void refetchLinkedin();
    void refetchBluesky();
    void refetchThreads();
    void refetchFacebook();
  }, [refetchSchedules, refetchPersonas, refetchYoutube, refetchInstagram, refetchLinkedin, refetchBluesky, refetchThreads, refetchFacebook]);

  return {
    scheduleById,
    personaNameById,
    accountOptions,
    // A failed personas fetch must not silently render "Removed persona"
    // labels — callers show the error state for it like any other query.
    // The account queries feed the filter dropdowns, so their loading and
    // errors count the same way: a failed one must surface the error state
    // (and the retry button must re-fetch it) instead of silently
    // rendering empty filters.
    isLoading:
      schedulesQuery.isLoading ||
      personasQuery.isLoading ||
      youtubeQuery.isLoading ||
      instagramQuery.isLoading ||
      linkedinQuery.isLoading ||
      blueskyQuery.isLoading ||
      threadsQuery.isLoading ||
      facebookQuery.isLoading,
    isError:
      schedulesQuery.isError ||
      personasQuery.isError ||
      youtubeQuery.isError ||
      instagramQuery.isError ||
      linkedinQuery.isError ||
      blueskyQuery.isError ||
      threadsQuery.isError ||
      facebookQuery.isError,
    refetch,
  };
}

export interface PostFilters {
  provider: ProviderFilter;
  account: string; // effective account filter ('all' or an account id)
  visibleAccounts: AccountOption[];
  hasActiveFilter: boolean;
  setProvider: (next: ProviderFilter) => void;
  setAccount: (next: string) => void;
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
      // A selected account that doesn't belong to the new network would
      // otherwise linger in state and silently reactivate when switching
      // back — reset it instead.
      setAccount((current) => resolveAccountFilter(current, next, accountOptions));
    },
    [accountOptions],
  );
  // Slots whose schedule was deleted never pass, so counts and the rendered
  // list always agree.
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
  return { provider, account, visibleAccounts, hasActiveFilter: provider !== 'all' || account !== 'all', setProvider, setAccount, passes };
}

const SELECT_CLASS = 'rounded-xl border border-input bg-card px-3 py-2 text-sm font-medium text-primary';
const LABEL_CLASS = 'flex flex-col gap-1 text-xs font-semibold text-muted-foreground';

export function PostFiltersBar({ filters }: { filters: PostFilters }) {
  const { t } = useI18n();
  return (
    <div className="mt-4 flex flex-wrap gap-3">
      <label className={LABEL_CLASS}>
        {t('posts.filterProvider')}
        <select
          value={filters.provider}
          onChange={(event) => {
            const next = PROVIDERS.find((item) => item === event.target.value) ?? 'all';
            filters.setProvider(next);
          }}
          className={SELECT_CLASS}
        >
          <option value="all">{t('posts.allProviders')}</option>
          {PROVIDERS.map((item) => (
            <option key={item} value={item}>
              {PROVIDER_LABELS[item]}
            </option>
          ))}
        </select>
      </label>
      <label className={LABEL_CLASS}>
        {t('posts.filterAccount')}
        <select value={filters.account} onChange={(event) => filters.setAccount(event.target.value)} className={SELECT_CLASS}>
          <option value="all">{t('posts.allAccounts')}</option>
          {filters.visibleAccounts.map((item) => (
            <option key={`${item.provider}:${item.id}`} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function SlotCard({ slot, joins }: { slot: ScheduledSlot; joins: PostJoins }) {
  const { t, locale } = useI18n();
  const schedule = joins.scheduleById.get(slot.scheduleId);
  // A post created without a persona (migration 012) has none to look up —
  // that is not a removed persona, and saying so would be a lie about a post
  // that never had one.
  const personaId = schedule?.personaId ?? null;
  const personaName = personaId === null ? t('posts.noPersona') : joins.personaNameById.get(personaId) ?? t('posts.personaFallback');
  return (
    <PostCard
      slot={slot}
      personaName={personaName}
      accounts={resolveSlotAccounts(schedule, joins.accountOptions)}
      locale={locale}
    />
  );
}
