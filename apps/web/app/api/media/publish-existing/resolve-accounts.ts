import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { AccountNeedsReconnectWarning } from '@/lib/account-needs-reconnect';
import { resolvePublishingAccounts } from '../../videos/generate-and-schedule/persona-prep';
import type { Provider } from '../../videos/generate-and-schedule/providers-validation';
import { validateAccounts } from '../../videos/generate-and-schedule/validate-accounts';
import { loadPublishBinding } from './bound-accounts';

//---------------
// resolvePublishAccounts — persona binding plus ownership checks for
// publish-existing. A dead login is a warning, not a refusal: the slot
// still schedules, and the caller surfaces account_needs_reconnect.
//---------------

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
