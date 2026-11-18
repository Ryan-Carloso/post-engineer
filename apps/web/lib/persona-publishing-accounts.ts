import type { SupabaseClient } from '@supabase/supabase-js';
import { SOCIAL_PROVIDERS, type SocialProvider } from './providers/registry';

export type PersonaDefaultAccounts = Record<SocialProvider, string[]>;

export function emptyPersonaDefaultAccounts(): PersonaDefaultAccounts {
  return { youtube: [], instagram: [], bluesky: [], linkedin: [], threads: [], facebook: [], pinterest: [], '3speak': [], rumble: [], fanvue: [] };
}

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

export async function getPersonaDefaultAccounts(
  supabase: SupabaseClient,
  personaId: string,
  userId: string,
): Promise<PersonaDefaultAccounts> {
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
  accounts: Partial<Record<string, string[]>>;
}

export async function setPersonaDefaultAccounts({
  supabase,
  userId,
  personaId,
  accounts,
}: SetPersonaDefaultAccountsParams): Promise<PersonaDefaultAccounts> {
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

  const wanted = normalizePublishingAccountsInput(accounts);
  if (totalBoundAccounts(wanted) === 0) {
    const invalid = new Error(AT_LEAST_ONE_BOUND_ACCOUNT_ERROR);
    (invalid as { code?: string }).code = 'VALIDATION_FAILED';
    throw invalid;
  }

  await validateOwnedAccounts(supabase, userId, wanted);

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
