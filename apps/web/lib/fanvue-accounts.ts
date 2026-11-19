'use client';

import { useSocialAccountsQuery, type ProviderAccountsResponse } from '@/lib/api';
import type { FanvueAccountData } from '@/lib/providers/registry';
import type { UseQueryResult } from '@tanstack/react-query';

export function useFanvueAccountsQuery(): UseQueryResult<ProviderAccountsResponse<FanvueAccountData>, Error> {
  return useSocialAccountsQuery((payload) => ({
    authenticated: payload.authenticated,
    accounts: payload.accounts.filter(
      (item): item is FanvueAccountData => item.provider === 'fanvue',
    ),
  }));
}
