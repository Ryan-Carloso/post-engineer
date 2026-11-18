'use client';

import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import type { PublicAccountItem, BlueskyAccountData, LinkedinAccountData, ThreadsAccountData, FacebookAccountData, ThreespeakAccountData, RumbleAccountData } from '@/lib/providers/registry';
import type {
  AccountResponse,
  AccountData,
  InstagramAccountResponse,
  InstagramAccountData,
} from '@/lib/types';
import { logger } from '@/lib/logger';
import { HttpStatusError } from '@/lib/errors';

interface ServerAccountPayload {
  authenticated: boolean;
  accounts: PublicAccountItem[];
  message?: string;
}

function selectProviderAccounts<T extends PublicAccountItem>(
  provider: T['provider'],
): (payload: ServerAccountPayload) => { authenticated: boolean; accounts: T[] } {
  return (payload) => ({
    authenticated: payload.authenticated,
    accounts: payload.accounts.filter((item): item is T => item.provider === provider),
  });
}

async function fetchProviderAccounts<T extends PublicAccountItem>(
  provider: T['provider'],
): Promise<{ authenticated: boolean; accounts: T[] }> {
  const payload = await fetchServerAccounts();
  return selectProviderAccounts<T>(provider)(payload);
}

async function fetchServerAccounts(): Promise<ServerAccountPayload> {
  try {
    const response = await fetch('/api/account');
    if (!response.ok) {
      throw new HttpStatusError(`Account request failed with status ${response.status}`, response.status);
    }
    const data: ServerAccountPayload = await response.json();
    return data;
  } catch (error) {
    logger.error('[api/account] network request failed', error);
    throw error;
  }
}

export async function fetchYouTubeAccounts(): Promise<AccountResponse> {
  return fetchProviderAccounts<AccountData>('youtube');
}

export async function fetchInstagramAccounts(): Promise<InstagramAccountResponse> {
  return fetchProviderAccounts<InstagramAccountData>('instagram');
}

export interface BlueskyAccountResponse {
  authenticated: boolean;
  accounts: BlueskyAccountData[];
}

export function useSocialAccountsQuery(): UseQueryResult<ServerAccountPayload, Error>;
export function useSocialAccountsQuery<TData>(
  select: (payload: ServerAccountPayload) => TData,
): UseQueryResult<TData, Error>;
export function useSocialAccountsQuery<TData>(
  select?: (payload: ServerAccountPayload) => TData,
): UseQueryResult<TData, Error> {
  return useQuery<ServerAccountPayload, Error, TData>({
    queryKey: ['social-accounts'],
    queryFn: fetchServerAccounts,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    select,
  });
}

const selectYouTubeAccounts = selectProviderAccounts<AccountData>('youtube');
const selectInstagramAccounts = selectProviderAccounts<InstagramAccountData>('instagram');
const selectBlueskyAccounts = selectProviderAccounts<BlueskyAccountData>('bluesky');
const selectLinkedinAccounts = selectProviderAccounts<LinkedinAccountData>('linkedin');
const selectThreadsAccounts = selectProviderAccounts<ThreadsAccountData>('threads');
const selectFacebookAccounts = selectProviderAccounts<FacebookAccountData>('facebook');
const selectThreespeakAccounts = selectProviderAccounts<ThreespeakAccountData>('3speak');
const selectRumbleAccounts = selectProviderAccounts<RumbleAccountData>('rumble');
export function useYouTubeAccountsQuery(): UseQueryResult<AccountResponse, Error> {
  return useSocialAccountsQuery(selectYouTubeAccounts);
}

export function useInstagramAccountsQuery(): UseQueryResult<InstagramAccountResponse, Error> {
  return useSocialAccountsQuery(selectInstagramAccounts);
}

export function useBlueskyAccountsQuery(): UseQueryResult<BlueskyAccountResponse, Error> {
  return useSocialAccountsQuery(selectBlueskyAccounts);
}

export type ProviderAccountsResponse<T extends PublicAccountItem> = { authenticated: boolean; accounts: T[] };

export function useLinkedinAccountsQuery(): UseQueryResult<ProviderAccountsResponse<LinkedinAccountData>, Error> {
  return useSocialAccountsQuery(selectLinkedinAccounts);
}

export function useThreadsAccountsQuery(): UseQueryResult<ProviderAccountsResponse<ThreadsAccountData>, Error> {
  return useSocialAccountsQuery(selectThreadsAccounts);
}

export function useFacebookAccountsQuery(): UseQueryResult<ProviderAccountsResponse<FacebookAccountData>, Error> {
  return useSocialAccountsQuery(selectFacebookAccounts);
}

export function useThreespeakAccountsQuery(): UseQueryResult<ProviderAccountsResponse<ThreespeakAccountData>, Error> {
  return useSocialAccountsQuery(selectThreespeakAccounts);
}

export function useRumbleAccountsQuery(): UseQueryResult<ProviderAccountsResponse<RumbleAccountData>, Error> {
  return useSocialAccountsQuery(selectRumbleAccounts);
}
