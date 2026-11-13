//---------------
// Social account validation, extracted from route.ts so the route module
// stays under the file-size ratchet. All checks run BEFORE any token is
// charged.
//
// One query loads all of the user's accounts; each requested id must
// belong to the user AND to the requested provider, distinguishing "not
// yours" from "yours but for another provider".
//
// Issue #572: when the post has a persona, every requested account must
// also be bound to that persona (persona_default_accounts). A persona
// with zero bound accounts cannot schedule at all — the caller gets a
// clear error naming the missing binding instead of the generic
// "select an account" message. Faceless posts (bound === null) keep the
// ownership-only checks.
//---------------

import type { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { logger } from '@/lib/logger';
import {
  totalBoundAccounts,
  type PersonaDefaultAccounts,
} from '@/lib/persona-publishing-accounts';
import { coded, validationFailed } from './prepare-persona';
import type { Provider } from './providers-validation';

export async function validateAccounts(
  supabase: SupabaseClient,
  userId: string,
  providers: Provider[],
  accounts: Record<string, string[] | undefined>,
  bound: PersonaDefaultAccounts | null,
): Promise<Record<Provider, string[]> | NextResponse> {
  const { data: rows, error } = await supabase
    .from('social_accounts')
    .select('provider, provider_account_id')
    .eq('user_id', userId);
  if (error) {
    logger.error('[generate-and-schedule] social accounts lookup failed', error, { userId });
    return coded(500, ERROR_CODES.INTERNAL_ERROR, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR));
  }
  const byProvider = new Map<string, Set<string>>();
  const providerOfId = new Map<string, string>();
  for (const row of rows ?? []) {
    const provider = (row as { provider: string }).provider;
    const accountId = (row as { provider_account_id: string }).provider_account_id;
    if (typeof provider !== 'string' || typeof accountId !== 'string') continue;
    if (!byProvider.has(provider)) byProvider.set(provider, new Set());
    byProvider.get(provider)?.add(accountId);
    providerOfId.set(accountId, provider);
  }

  const accountIds = {} as Record<Provider, string[]>;
  for (const provider of providers) {
    const field = `publishing.accounts.${provider}`;
    const ids = [...new Set((accounts[provider] ?? []).map((id) => id.trim()).filter((id) => id.length > 0))];
    accountIds[provider] = ids;
    if (ids.length === 0) {
      const connected = byProvider.get(provider);
      if (!connected || connected.size === 0) {
        return validationFailed(
          ERROR_CODES.NO_CONNECTED_ACCOUNTS,
          formatErrorMessage(ERROR_CODES.NO_CONNECTED_ACCOUNTS, { provider }),
          field,
        );
      }
      if (bound !== null && totalBoundAccounts(bound) === 0) {
        return validationFailed(
          ERROR_CODES.PERSONA_NO_BOUND_ACCOUNTS,
          formatErrorMessage(ERROR_CODES.PERSONA_NO_BOUND_ACCOUNTS),
          field,
        );
      }
      return validationFailed(
        ERROR_CODES.INVALID_PROVIDER_ACCOUNT,
        bound !== null
          ? `Select at least one ${provider} account bound to this persona.`
          : `Select at least one ${provider} account to publish to.`,
        field,
      );
    }
    for (const id of ids) {
      if (byProvider.get(provider)?.has(id)) {
        // Owned for this provider — now the binding check (issue #572):
        // an owned account the persona is not bound to is refused here,
        // before any token is charged.
        if (bound !== null && !bound[provider].includes(id)) {
          return validationFailed(
            ERROR_CODES.ACCOUNT_NOT_BOUND_TO_PERSONA,
            formatErrorMessage(ERROR_CODES.ACCOUNT_NOT_BOUND_TO_PERSONA, { provider }),
            field,
          );
        }
        continue;
      }
      const actualProvider = providerOfId.get(id);
      if (actualProvider) {
        return validationFailed(
          ERROR_CODES.INVALID_PROVIDER_ACCOUNT,
          `Selected account cannot be used with ${provider}.`,
          field,
        );
      }
      return validationFailed(
        ERROR_CODES.SOCIAL_ACCOUNT_NOT_OWNED,
        formatErrorMessage(ERROR_CODES.SOCIAL_ACCOUNT_NOT_OWNED, { provider }),
        field,
      );
    }
  }
  return accountIds;
}
