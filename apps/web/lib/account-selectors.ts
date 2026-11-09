// Selectors for the shared /api/account payload.
//
// The shape and the provider list come from the registry
// (lib/providers/registry.ts): the server already returns each account with
// provider and correct fields.
import type { PublicAccountItem } from '@/lib/providers/registry';

export interface ServerAccountPayload {
  authenticated: boolean;
  accounts: PublicAccountItem[];
  message?: string;
}

//---------------
// fetchProviderAccounts — single fetch from /api/account filtered by provider.
//---------------
export function selectProviderAccounts<T extends PublicAccountItem>(
  provider: T['provider'],
): (payload: ServerAccountPayload) => { authenticated: boolean; accounts: T[] } {
  return (payload) => ({
    authenticated: payload.authenticated,
    accounts: payload.accounts.filter((item): item is T => item.provider === provider),
  });
}
