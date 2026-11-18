'use client';

import { useSocialAccountsQuery, type ProviderAccountsResponse } from '@/lib/api';
import type { PinterestAccountData } from '@/lib/providers/registry';
import type { UseQueryResult } from '@tanstack/react-query';

export function usePinterestAccountsQuery(): UseQueryResult<ProviderAccountsResponse<PinterestAccountData>, Error> {
  return useSocialAccountsQuery((payload) => ({
    authenticated: payload.authenticated,
    accounts: payload.accounts.filter(
      (item): item is PinterestAccountData => item.provider === 'pinterest',
    ),
  }));
}
