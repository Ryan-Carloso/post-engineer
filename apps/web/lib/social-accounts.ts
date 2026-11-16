import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.gen';
import { encryptTokens, decryptTokens } from '@/lib/token-crypto';
import { AccountNotFoundError } from '@/lib/errors';
import type { SocialProvider } from '@/lib/providers/registry';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

//---------------
// Social Accounts — OAuth account persistence in Supabase.
// Tokens are always encrypted (AES-256-GCM) before going to the database.
// Reads use the caller client (session RLS, or the caller's user_id filter).
// Writes use the service client: a cookie JWT cannot store ciphertext.
// The provider list lives in lib/providers/registry.ts (single source).
//---------------

export type { SocialProvider };

export interface SocialTokenPayload {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expiry_date?: number;
  // Extra provider fields live inside the encrypted blob; the index
  // signature allows storing them securely.
  [key: string]: unknown;
}

export interface SocialAccountRecord {
  id: string;
  userId: string;
  provider: SocialProvider;
  providerAccountId: string;
  accountName: string | null;
  accountMetadata: Record<string, unknown>;
  tokenExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

// Columns a session JWT may read. encrypted_tokens is omitted: 066 grants
// no SELECT on that column, and PostgREST rejects a select list that asks
// for it. Ciphertext is loaded with the service client after ownership
// is proven (getSocialAccountTokens).
export const SOCIAL_ACCOUNT_PUBLIC_COLUMNS =
  'id, user_id, provider, provider_account_id, account_name, account_metadata, token_expires_at, created_at, updated_at, last_used_at';

interface SocialAccountPublicRow {
  id: string;
  user_id: string;
  provider: SocialProvider;
  provider_account_id: string;
  account_name: string | null;
  account_metadata: unknown;
  token_expires_at: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export interface UpsertSocialAccountParams {
  userId: string;
  provider: SocialProvider;
  providerAccountId: string;
  accountName?: string | null;
  accountMetadata?: Record<string, unknown>;
  tokens: SocialTokenPayload;
  tokenExpiresAt?: Date | null;
}

//---------------
// rowToRecord — converts a database row into a public record (no tokens)
//---------------
function rowToRecord(row: SocialAccountPublicRow): SocialAccountRecord {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    accountName: row.account_name,
    accountMetadata: asRecord(row.account_metadata),
    tokenExpiresAt: row.token_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
  };
}

//---------------
// asRecord — guarantees an object (jsonb may come back as object or null)
//---------------
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

//---------------
// isPlaceholderProviderAccountId — empty/sentinel ids a failed profile lookup
// used to leave behind ('unknown'); never a valid provider identity.
//---------------
export function isPlaceholderProviderAccountId(id: string): boolean {
  const normalized = id.trim().toLowerCase();
  return normalized === '' || normalized === 'unknown';
}

//---------------
// Service role bypasses RLS. Writes store ciphertext and identity columns
// a cookie JWT must not set. Update, touch, and delete first prove the row
// is visible to the caller client, then write with id and user_id. The
// upsert's userId is the authenticated user the route already checked.
//---------------
function serviceSocial(): SupabaseClient<Database> {
  return createSupabaseServiceClient();
}

async function ownedAccountId(
  supabase: SupabaseClient<Database>,
  userId: string,
  provider: SocialProvider,
  providerAccountId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('social_accounts')
    .select('id')
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('provider_account_id', providerAccountId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to get social account: ${error.message}`);
  }
  if (typeof data?.id !== 'string') return null;
  return data.id;
}

//---------------
// upsertSocialAccount — encrypts the tokens and upserts
// (unique: user_id + provider + provider_account_id)
//---------------
export async function upsertSocialAccount(
  _supabase: SupabaseClient<Database>,
  params: UpsertSocialAccountParams,
): Promise<SocialAccountRecord> {
  // A placeholder id poisons the row (every later publish targets a
  // non-existent account and fails with a bare Unauthorized), so refuse to
  // persist it no matter which callback produced it.
  if (isPlaceholderProviderAccountId(params.providerAccountId)) {
    throw new Error(
      `Refusing to save a ${params.provider} account without a real provider account id.`,
    );
  }
  const encrypted = encryptTokens(params.tokens);

  const expiresAt = params.tokenExpiresAt
    ? params.tokenExpiresAt.toISOString()
    : null;

  const payload = {
    user_id: params.userId,
    provider: params.provider,
    provider_account_id: params.providerAccountId,
    account_name: params.accountName ?? null,
    account_metadata: params.accountMetadata ?? {},
    encrypted_tokens: encrypted,
    token_expires_at: expiresAt,
    updated_at: new Date().toISOString(),
    last_used_at: new Date().toISOString(),
  };

  const { data, error } = await serviceSocial()
    .from('social_accounts')
    .upsert(payload, { onConflict: 'user_id,provider,provider_account_id' })
    .select(SOCIAL_ACCOUNT_PUBLIC_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Failed to upsert social account: ${error.message}`);
  }

  return rowToRecord(asPublicRow(data));
}

//---------------
// listSocialAccounts — lists a user's accounts (NO tokens)
//---------------
export async function listSocialAccounts(
  supabase: SupabaseClient<Database>,
  userId: string,
  provider?: SocialProvider,
): Promise<SocialAccountRecord[]> {
  let query = supabase
    .from('social_accounts')
    .select(SOCIAL_ACCOUNT_PUBLIC_COLUMNS)
    .eq('user_id', userId);

  if (provider) {
    query = query.eq('provider', provider);
  }

  const { data, error } = await query.order('last_used_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to list social accounts: ${error.message}`);
  }

  return (data ?? []).map((row) => rowToRecord(asPublicRow(row)));
}

//---------------
// getSocialAccountTokens — fetches the account and decrypts the tokens
//---------------
export async function getSocialAccountTokens(
  supabase: SupabaseClient<Database>,
  userId: string,
  provider: SocialProvider,
  providerAccountId: string,
): Promise<{ tokens: SocialTokenPayload; account: SocialAccountRecord }> {
  const { data, error } = await supabase
    .from('social_accounts')
    .select(SOCIAL_ACCOUNT_PUBLIC_COLUMNS)
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('provider_account_id', providerAccountId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get social account: ${error.message}`);
  }

  if (!data) {
    throw new AccountNotFoundError(
      `Social account not found for ${provider}/${providerAccountId}`,
    );
  }

  const account = rowToRecord(asPublicRow(data));

  // Service role bypasses RLS. The caller client just proved this row
  // belongs to userId (session RLS, or that client's own user_id filter).
  // Both predicates are required: a mismatched id must not return another
  // user's ciphertext.
  const { data: secret, error: secretError } = await createSupabaseServiceClient()
    .from('social_accounts')
    .select('encrypted_tokens')
    .eq('id', account.id)
    .eq('user_id', userId)
    .maybeSingle();

  if (secretError) {
    throw new Error(`Failed to get social account: ${secretError.message}`);
  }

  if (!secret) {
    throw new AccountNotFoundError(
      `Social account not found for ${provider}/${providerAccountId}`,
    );
  }

  return { tokens: decryptTokens(encryptedTokensFrom(secret)), account };
}

//---------------
// touchSocialAccount — records last_used_at after a successful publish
//---------------
export async function touchSocialAccount(
  supabase: SupabaseClient<Database>,
  userId: string,
  provider: SocialProvider,
  providerAccountId: string,
): Promise<void> {
  const accountId = await ownedAccountId(supabase, userId, provider, providerAccountId);
  if (accountId === null) return;
  const { error } = await serviceSocial()
    .from('social_accounts')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', accountId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to touch social account: ${error.message}`);
  }
}

//---------------
// updateSocialAccountTokens — re-encrypts tokens after refresh
//---------------
export async function updateSocialAccountTokens(
  supabase: SupabaseClient<Database>,
  userId: string,
  provider: SocialProvider,
  providerAccountId: string,
  tokens: SocialTokenPayload,
): Promise<void> {
  const accountId = await ownedAccountId(supabase, userId, provider, providerAccountId);
  if (accountId === null) {
    throw new AccountNotFoundError(
      `Social account not found for ${provider}/${providerAccountId}`,
    );
  }
  const encrypted = encryptTokens(tokens);
  const expiresAt = tokens.expiry_date
    ? new Date(tokens.expiry_date).toISOString()
    : null;

  const { error } = await serviceSocial()
    .from('social_accounts')
    .update({
      encrypted_tokens: encrypted,
      token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to update social account tokens: ${error.message}`);
  }
}

//---------------
// updateSocialAccountMetadata — updates the account's public data
//---------------
export async function updateSocialAccountMetadata(
  supabase: SupabaseClient<Database>,
  userId: string,
  provider: SocialProvider,
  providerAccountId: string,
  accountMetadata: Record<string, unknown>,
  accountName?: string,
): Promise<void> {
  const accountId = await ownedAccountId(supabase, userId, provider, providerAccountId);
  if (accountId === null) {
    throw new AccountNotFoundError(
      `Social account not found for ${provider}/${providerAccountId}`,
    );
  }
  const { error } = await serviceSocial()
    .from('social_accounts')
    .update({
      account_metadata: accountMetadata,
      ...(accountName === undefined ? {} : { account_name: accountName }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to update social account metadata: ${error.message}`);
  }
}

//---------------
// deleteSocialAccount — removes an account from a user (logout)
//---------------
export async function deleteSocialAccount(
  supabase: SupabaseClient<Database>,
  userId: string,
  provider: SocialProvider,
  providerAccountId: string,
): Promise<void> {
  const accountId = await ownedAccountId(supabase, userId, provider, providerAccountId);
  if (accountId === null) return;
  const { error } = await serviceSocial()
    .from('social_accounts')
    .delete()
    .eq('id', accountId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to delete social account: ${error.message}`);
  }
}

//---------------
// asPublicRow — types supabase-js's generic return without using any
//---------------
function asPublicRow(data: unknown): SocialAccountPublicRow {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid social account row');
  }
  return data as SocialAccountPublicRow;
}

function encryptedTokensFrom(data: unknown): string {
  if (typeof data !== 'object' || data === null || !('encrypted_tokens' in data)) {
    throw new Error('Invalid social account row');
  }
  const value = (data as { encrypted_tokens: unknown }).encrypted_tokens;
  if (typeof value !== 'string') {
    throw new Error('Invalid social account row');
  }
  return value;
}