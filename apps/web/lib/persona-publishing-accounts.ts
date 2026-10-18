import type { SupabaseClient } from '@supabase/supabase-js';
import { SOCIAL_PROVIDERS, type SocialProvider } from './providers/registry';

//---------------
// persona-publishing-accounts — per-persona default publishing accounts
// (issue #212, migration 022).
//
// Social accounts belong to the USER (social_accounts.user_id); this table
// records which of them each persona publishes to by default. Callers that
// omit publishing.accounts get the persona's defaults; explicit accounts
// always win. All functions re-check ownership explicitly: the service-role
// client bypasses RLS, so trust lives in code, not in the policy.
//---------------

export type PersonaDefaultAccounts = Record<SocialProvider, string[]>;

export function emptyPersonaDefaultAccounts(): PersonaDefaultAccounts {
  return { youtube: [], instagram: [], bluesky: [], linkedin: [] };
}

function isSocialProvider(value: unknown): value is SocialProvider {
  return (
    typeof value === 'string' &&
    (SOCIAL_PROVIDERS as readonly string[]).includes(value)
  );
}

//---------------
// getPersonaDefaultAccounts — the persona's defaults grouped per provider.
// Unknown providers are dropped; every known provider is always present
// (possibly empty), so callers never have to null-check.
//---------------
export async function getPersonaDefaultAccounts(
  supabase: SupabaseClient,
  personaId: string,
): Promise<PersonaDefaultAccounts> {
  const defaults = emptyPersonaDefaultAccounts();
  const { data, error } = await supabase
    .from('persona_default_accounts')
    .select('provider, provider_account_id')
    .eq('persona_id', personaId);
  if (error) {
    throw new Error(`Failed to list persona default accounts: ${error.message}`);
  }
  for (const row of data ?? []) {
    const provider = (row as { provider: unknown }).provider;
    const accountId = (row as { provider_account_id: unknown }).provider_account_id;
    if (!isSocialProvider(provider) || typeof accountId !== 'string' || accountId === '') continue;
    defaults[provider].push(accountId);
  }
  return defaults;
}

export interface SetPersonaDefaultAccountsParams {
  supabase: SupabaseClient;
  userId: string;
  personaId: string;
  // PUT semantics: the whole map is replaced. A provider mapped to [] (or
  // omitted) keeps no defaults. Unknown providers are rejected, never stored.
  accounts: Partial<Record<string, string[]>>;
}

//---------------
// setPersonaDefaultAccounts — replace-all write of a persona's defaults.
// Fails when the persona does not belong to the user, when a provider is
// unknown, or when an account id is not one of the user's connected
// accounts for that provider. Returns the new state.
//---------------
export async function setPersonaDefaultAccounts({
  supabase,
  userId,
  personaId,
  accounts,
}: SetPersonaDefaultAccountsParams): Promise<PersonaDefaultAccounts> {
  // 1. The persona must belong to the caller — a forged persona_id can never
  //    attach defaults to someone else's persona.
  const { data: persona, error: personaError } = await supabase
    .from('personas')
    .select('id')
    .eq('id', personaId)
    .eq('user_id', userId)
    .maybeSingle();
  if (personaError) {
    throw new Error(`Failed to load persona: ${personaError.message}`);
  }
  if (!persona) {
    const notFound = new Error('Persona not found.');
    (notFound as { code?: string }).code = 'PERSONA_NOT_FOUND';
    throw notFound;
  }

  // 2. Normalize + validate the requested map before touching the table.
  const wanted = emptyPersonaDefaultAccounts();
  for (const [rawProvider, rawIds] of Object.entries(accounts)) {
    if (!isSocialProvider(rawProvider)) {
      const invalid = new Error(`Unknown provider: ${rawProvider}.`);
      (invalid as { code?: string }).code = 'VALIDATION_FAILED';
      throw invalid;
    }
    if (!Array.isArray(rawIds)) {
      const invalid = new Error(`Accounts for ${rawProvider} must be an array of account ids.`);
      (invalid as { code?: string }).code = 'INVALID_PARAMS';
      throw invalid;
    }
    wanted[rawProvider] = [...new Set(rawIds.map((id) => String(id).trim()).filter((id) => id !== ''))];
  }

  // 3. Every requested id must be one of the user's connected accounts for
  //    that provider — defaults can never point at someone else's account.
  const needed = new Set<string>();
  for (const ids of Object.values(wanted)) for (const id of ids) needed.add(id);
  if (needed.size > 0) {
    const { data: rows, error: accountsError } = await supabase
      .from('social_accounts')
      .select('provider, provider_account_id')
      .eq('user_id', userId);
    if (accountsError) {
      throw new Error(`Failed to list social accounts: ${accountsError.message}`);
    }
    const owned = new Set<string>();
    for (const row of rows ?? []) {
      const provider = (row as { provider: unknown }).provider;
      const accountId = (row as { provider_account_id: unknown }).provider_account_id;
      if (typeof provider === 'string' && typeof accountId === 'string') {
        owned.add(`${provider}:${accountId}`);
      }
    }
    for (const provider of SOCIAL_PROVIDERS) {
      for (const id of wanted[provider]) {
        if (!owned.has(`${provider}:${id}`)) {
          const invalid = new Error(
            `Account ${id} is not a connected ${provider} account of this user.`,
          );
          (invalid as { code?: string }).code = 'INVALID_PROVIDER_ACCOUNT';
          throw invalid;
        }
      }
    }
  }

  // 4. Replace-all: delete the persona's rows, then insert the new set.
  //    (The table is tiny per persona; a single round-trip pair beats an
  //    upsert-diff here, and the PK makes the write idempotent.)
  const { error: deleteError } = await supabase
    .from('persona_default_accounts')
    .delete()
    .eq('persona_id', personaId);
  if (deleteError) {
    throw new Error(`Failed to replace persona default accounts: ${deleteError.message}`);
  }
  const inserts: { persona_id: string; provider: string; provider_account_id: string }[] = [];
  for (const provider of SOCIAL_PROVIDERS) {
    for (const id of wanted[provider]) {
      inserts.push({ persona_id: personaId, provider, provider_account_id: id });
    }
  }
  if (inserts.length > 0) {
    const { error: insertError } = await supabase.from('persona_default_accounts').insert(inserts);
    if (insertError) {
      throw new Error(`Failed to save persona default accounts: ${insertError.message}`);
    }
  }
  return wanted;
}
