import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { AccountNeedsReconnectWarning } from '@/lib/account-needs-reconnect';
import { getPersonaDefaultAccounts, type PersonaDefaultAccounts } from '@/lib/persona-publishing-accounts';
import type { Provider } from './providers-validation';
import { validateAccounts } from './validate-accounts';
import { loadPublishBinding } from './bound-accounts';

export async function resolvePublishingAccounts(
  supabase: SupabaseClient,
  personaId: string | null,
  explicitAccounts: Record<string, string[] | undefined> | undefined,
  bound: PersonaDefaultAccounts | undefined,
  userId: string,
): Promise<Record<string, string[] | undefined>> {
  const accounts = explicitAccounts ?? {};
  if (Object.keys(accounts).length === 0 && personaId !== null) {
    if (bound !== undefined) return bound;
    return getPersonaDefaultAccounts(supabase, personaId, userId);
  }
  return accounts;
}

export async function resolvePublishAccounts(
  supabase: SupabaseClient,
  userId: string,
  personaId: string | null,
  providers: Provider[],
  accounts: Record<string, string[] | undefined> | undefined,
  route: string,
): Promise<
  | { accountIds: Record<Provider, string[]>; reconnectWarning: AccountNeedsReconnectWarning | null }
  | NextResponse
> {
  const bound = await loadPublishBinding(supabase, personaId, userId, route);
  if (bound instanceof NextResponse) return bound;
  const resolved = await resolvePublishingAccounts(supabase, personaId, accounts, bound ?? undefined, userId);
  return validateAccounts(supabase, userId, providers, resolved, bound);
}
