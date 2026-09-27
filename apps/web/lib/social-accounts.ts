import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptTokens, decryptTokens } from '@/lib/token-crypto';
import type { SocialProvider } from '@/lib/providers/registry';

//---------------
// Social Accounts — OAuth account persistence in Supabase.
// Tokens are always encrypted (AES-256-GCM) before going to the database.
// The client is passed by the caller: session client (RLS) for routes
// authenticated by cookie, or a service_role client for API key routes.
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

interface SocialAccountRow {
  id: string;
  user_id: string;
  provider: SocialProvider;
  provider_account_id: string;
  account_name: string | null;
  account_metadata: unknown;
  encrypted_tokens: string;
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
function rowToRecord(row: SocialAccountRow): SocialAccountRecord {
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
// upsertSocialAccount — encrypts the tokens and upserts
// (unique: user_id + provider + provider_account_id)
//---------------
export async function upsertSocialAccount(
  supabase: SupabaseClient,
  params: UpsertSocialAccountParams,
): Promise<SocialAccountRecord> {
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

  const { data, error } = await supabase
    .from('social_accounts')
    .upsert(payload, { onConflict: 'user_id,provider,provider_account_id' })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to upsert social account: ${error.message}`);
  }

  return rowToRecord(asRow(data));
}

//---------------
// listSocialAccounts — lists a user's accounts (NO tokens)
//---------------
export async function listSocialAccounts(
  supabase: SupabaseClient,
  userId: string,
  provider?: SocialProvider,
): Promise<SocialAccountRecord[]> {
  let query = supabase
    .from('social_accounts')
    .select('*')
    .eq('user_id', userId);

  if (provider) {
    query = query.eq('provider', provider);
  }

  const { data, error } = await query.order('last_used_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to list social accounts: ${error.message}`);
  }

  return (data ?? []).map((row) => rowToRecord(asRow(row)));
}

//---------------
// getSocialAccountTokens — fetches the account and decrypts the tokens
//---------------
export async function getSocialAccountTokens(
  supabase: SupabaseClient,
  userId: string,
  provider: SocialProvider,
  providerAccountId: string,
): Promise<{ tokens: SocialTokenPayload; account: SocialAccountRecord }> {
  const { data, error } = await supabase
    .from('social_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('provider_account_id', providerAccountId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get social account: ${error.message}`);
  }

  if (!data) {
    throw new Error(
      `Social account not found for ${provider}/${providerAccountId}`,
    );
  }

  const row = asRow(data);
  const tokens = decryptTokens(row.encrypted_tokens);

  return { tokens, account: rowToRecord(row) };
}

//---------------
// touchSocialAccount — atualiza last_used_at
//---------------
export async function touchSocialAccount(
  supabase: SupabaseClient,
  userId: string,
  provider: SocialProvider,
  providerAccountId: string,
): Promise<void> {
  const { error } = await supabase
    .from('social_accounts')
    .update({ last_used_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('provider_account_id', providerAccountId);

  if (error) {
    throw new Error(`Failed to touch social account: ${error.message}`);
  }
}

//---------------
// updateSocialAccountTokens — re-encrypts tokens after refresh
//---------------
export async function updateSocialAccountTokens(
  supabase: SupabaseClient,
  userId: string,
  provider: SocialProvider,
  providerAccountId: string,
  tokens: SocialTokenPayload,
): Promise<void> {
  const encrypted = encryptTokens(tokens);
  const expiresAt = tokens.expiry_date
    ? new Date(tokens.expiry_date).toISOString()
    : null;

  const { error } = await supabase
    .from('social_accounts')
    .update({
      encrypted_tokens: encrypted,
      token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('provider_account_id', providerAccountId);

  if (error) {
    throw new Error(`Failed to update social account tokens: ${error.message}`);
  }
}

//---------------
// updateSocialAccountMetadata — updates the account's public data
//---------------
export async function updateSocialAccountMetadata(
  supabase: SupabaseClient,
  userId: string,
  provider: SocialProvider,
  providerAccountId: string,
  accountMetadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from('social_accounts')
    .update({
      account_metadata: accountMetadata,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('provider_account_id', providerAccountId);

  if (error) {
    throw new Error(`Failed to update social account metadata: ${error.message}`);
  }
}

//---------------
// deleteSocialAccount — removes an account from a user (logout)
//---------------
export async function deleteSocialAccount(
  supabase: SupabaseClient,
  userId: string,
  provider: SocialProvider,
  providerAccountId: string,
): Promise<void> {
  const { error } = await supabase
    .from('social_accounts')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('provider_account_id', providerAccountId);

  if (error) {
    throw new Error(`Failed to delete social account: ${error.message}`);
  }
}

//---------------
// asRow — types supabase-js's generic return without using any
//---------------
function asRow(data: unknown): SocialAccountRow {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid social account row');
  }
  return data as SocialAccountRow;
}