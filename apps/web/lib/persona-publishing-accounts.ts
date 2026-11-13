import type { SupabaseClient } from '@supabase/supabase-js';
import { SOCIAL_PROVIDERS, type SocialProvider } from './providers/registry';

//---------------
// persona-publishing-accounts — per-persona bound publishing accounts
// (issue #212, migration 022; made mandatory by issue #572).
//
// Social accounts belong to the USER (social_accounts.user_id); this table
// records which of them each persona publishes to. A persona with zero
// bound accounts must not exist: creation requires at least one, the
// binding can never be emptied, and generate-and-schedule publishes only
// to bound accounts (explicit accounts must be a subset; omitted accounts
// fall back to the binding). All functions re-check ownership explicitly:
// the service-role client bypasses RLS, so trust lives in code, not in
// the policy.
//---------------

export type PersonaDefaultAccounts = Record<SocialProvider, string[]>;

export function emptyPersonaDefaultAccounts(): PersonaDefaultAccounts {
  return { youtube: [], instagram: [], bluesky: [], linkedin: [], threads: [], facebook: [], pinterest: [], '3speak': [], rumble: [], fanvue: [] };
}

/** Total bound accounts across providers. */
export function totalBoundAccounts(accounts: PersonaDefaultAccounts): number {
  let total = 0;
  for (const ids of Object.values(accounts)) total += ids.length;
  return total;
}

const AT_LEAST_ONE_BOUND_ACCOUNT_ERROR =
  'A persona must have at least one bound account.';

function isSocialProvider(value: unknown): value is SocialProvider {
  return (
    typeof value === 'string' &&
    (SOCIAL_PROVIDERS as readonly string[]).includes(value)
  );
}

//---------------
// normalizePublishingAccountsInput — shape-check + normalize a raw
// provider→ids map (from a JSON body or a multipart field). Unknown
// providers are rejected, never stored; ids are trimmed, deduped, and
// empties dropped. Throws with a stable code on the first problem.
//---------------
export function normalizePublishingAccountsInput(
  accounts: unknown,
): PersonaDefaultAccounts {
  if (typeof accounts !== 'object' || accounts === null || Array.isArray(accounts)) {
    const invalid = new Error('accounts must be an object mapping providers to account id arrays.');
    (invalid as { code?: string }).code = 'VALIDATION_FAILED';
    throw invalid;
  }
  const wanted = emptyPersonaDefaultAccounts();
  for (const [rawProvider, rawIds] of Object.entries(accounts as Record<string, unknown>)) {
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
  return wanted;
}

//---------------
// parsePublishingAccountsField — the create-persona multipart field
// (`publishingAccounts`, a JSON string). A missing field, malformed JSON,
// or a map with zero accounts is a 400: a persona is born with at least
// one bound account, never with none.
//---------------
export function parsePublishingAccountsField(
  raw: unknown,
): { ok: true; accounts: PersonaDefaultAccounts } | { ok: false; error: string } {
  if (raw === null || raw === undefined || typeof raw !== 'string') {
    return { ok: false, error: 'Select at least one publishing account for this persona.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'publishingAccounts must be valid JSON.' };
  }
  let accounts: PersonaDefaultAccounts;
  try {
    accounts = normalizePublishingAccountsInput(parsed);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid publishingAccounts.' };
  }
  if (totalBoundAccounts(accounts) === 0) {
    return { ok: false, error: 'Select at least one publishing account for this persona.' };
  }
  return { ok: true, accounts };
}

//---------------
// validateOwnedAccounts — every requested id must be one of the user's
// connected accounts for that provider; a binding can never point at
// someone else's account. Throws INVALID_PROVIDER_ACCOUNT on the first
// id that fails.
//---------------
export async function validateOwnedAccounts(
  supabase: SupabaseClient,
  userId: string,
  wanted: PersonaDefaultAccounts,
): Promise<void> {
  const needed = new Set<string>();
  for (const ids of Object.values(wanted)) for (const id of ids) needed.add(id);
  if (needed.size === 0) return;
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

//---------------
// getPersonaDefaultAccountsForPersonas — bulk form of
// getPersonaDefaultAccounts for list views (issue #572): one query for
// many personas. Every requested id is pre-seeded with an empty map, so
// a persona with no bound accounts reads as all-empty (never absent);
// rows for unrequested personas, unknown providers, and empty ids are
// dropped.
//---------------
export async function getPersonaDefaultAccountsForPersonas(
  supabase: SupabaseClient,
  personaIds: string[],
): Promise<Map<string, PersonaDefaultAccounts>> {
  const byPersona = new Map<string, PersonaDefaultAccounts>();
  for (const id of personaIds) byPersona.set(id, emptyPersonaDefaultAccounts());
  if (personaIds.length === 0) return byPersona;
  const { data, error } = await supabase
    .from('persona_default_accounts')
    .select('persona_id, provider, provider_account_id')
    .in('persona_id', personaIds);
  if (error) {
    throw new Error(`Failed to list persona default accounts: ${error.message}`);
  }
  for (const row of data ?? []) {
    const personaId = (row as { persona_id: unknown }).persona_id;
    const provider = (row as { provider: unknown }).provider;
    const accountId = (row as { provider_account_id: unknown }).provider_account_id;
    if (typeof personaId !== 'string') continue;
    const defaults = byPersona.get(personaId);
    if (!defaults) continue;
    if (!isSocialProvider(provider) || typeof accountId !== 'string' || accountId === '') continue;
    defaults[provider].push(accountId);
  }
  return byPersona;
}

export interface SetPersonaDefaultAccountsParams {
  supabase: SupabaseClient;
  userId: string;
  personaId: string;
  // PUT semantics: the whole map is replaced. A provider mapped to [] (or
  // omitted) keeps no defaults. Unknown providers are rejected, never stored.
  // The map as a whole must bind at least one account (issue #572): an
  // empty map is rejected and the previous binding survives.
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
  // A persona must keep at least one bound account (issue #572): an empty
  // map would unbind the persona entirely, so it is rejected before the
  // replace-all delete runs and the previous binding survives.
  const wanted = normalizePublishingAccountsInput(accounts);
  if (totalBoundAccounts(wanted) === 0) {
    const invalid = new Error(AT_LEAST_ONE_BOUND_ACCOUNT_ERROR);
    (invalid as { code?: string }).code = 'VALIDATION_FAILED';
    throw invalid;
  }

  // 3. Every requested id must be one of the user's connected accounts for
  //    that provider — defaults can never point at someone else's account.
  await validateOwnedAccounts(supabase, userId, wanted);

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
