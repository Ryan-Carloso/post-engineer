'use client';

import { useSocialAccountsQuery, type ProviderAccountsResponse } from '@/lib/api';
import type { FanvueAccountData } from '@/lib/providers/registry';
import type { UseQueryResult } from '@tanstack/react-query';

//---------------
// useFanvueAccountsQuery — the connected Fanvue accounts, filtered
// from the single shared ['social-accounts'] query like every other
// provider hook in lib/api.ts. It lives here (not in lib/api.ts) because
// that file is grandfathered over the 500-line file-size cap and may not
// grow by a single line.
//---------------

export function useFanvueAccountsQuery(): UseQueryResult<ProviderAccountsResponse<FanvueAccountData>, Error> {
  return useSocialAccountsQuery((payload) => ({
    authenticated: payload.authenticated,
    accounts: payload.accounts.filter(
      (item): item is FanvueAccountData => item.provider === 'fanvue',
    ),
  }));
}
