'use client';

import { useSocialAccountsQuery, type ProviderAccountsResponse } from '@/lib/api';
import type { PinterestAccountData } from '@/lib/providers/registry';
import type { UseQueryResult } from '@tanstack/react-query';

//---------------
// usePinterestAccountsQuery — the connected Pinterest accounts, filtered
// from the single shared ['social-accounts'] query like every other
// provider hook in lib/api.ts. It lives here (not in lib/api.ts) because
// that file is grandfathered over the 500-line file-size cap and may not
// grow by a single line.
//---------------

export function usePinterestAccountsQuery(): UseQueryResult<ProviderAccountsResponse<PinterestAccountData>, Error> {
  return useSocialAccountsQuery((payload) => ({
    authenticated: payload.authenticated,
    accounts: payload.accounts.filter(
      (item): item is PinterestAccountData => item.provider === 'pinterest',
    ),
  }));
}
