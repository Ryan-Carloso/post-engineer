import { createHash, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

const KEY_PREFIX = 'pe_live_';
const MIN_KEY_LENGTH = 32;

export function generateRawApiKey(): string {
  const bytes = randomBytes(24).toString('hex');
  return `${KEY_PREFIX}${bytes}`;
}

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

export function extractKeyPrefix(rawKey: string): string {
  const visibleLength = KEY_PREFIX.length + 8;
  const slice = rawKey.slice(0, visibleLength);
  return `${slice}...`;
}

export function validateApiKeyFormat(rawKey: string): boolean {
  if (typeof rawKey !== 'string') return false;
  if (!rawKey.startsWith(KEY_PREFIX)) return false;
  return rawKey.length >= MIN_KEY_LENGTH;
}

export interface ResolvedApiKey {
  userId: string;
  keyId: string;
  personaIds: string[] | null;
}

export async function resolveApiKey(
  rawKey: string,
  supabase: SupabaseClient
): Promise<ResolvedApiKey | null> {
  if (!validateApiKeyFormat(rawKey)) {
    return null;
  }

  const keyHash = hashApiKey(rawKey);

  const { data, error } = await supabase
    .from('user_api_keys')
    .select('id, user_id, persona_ids, revoked_at')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .single();

  if (error || !data) {
    return null;
  }

  await supabase
    .from('user_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id);

  const personaIds = Array.isArray(data.persona_ids)
    ? (data.persona_ids as unknown[]).filter(
      (value): value is string => typeof value === 'string',
    )
    : null;

  return {
    userId: data.user_id as string,
    keyId: data.id as string,
    personaIds,
  };
}

//---------------
// isScopedApiKey — API key with an explicit persona restriction.
// Restricted keys cannot create new personas (the scope is fixed at
// creation) and can only see/operate on the listed personas.
//---------------
export interface PersonaScopeContext {
  isApiKey?: boolean;
  personaIds?: string[] | null;
}

export function isScopedApiKey(auth: PersonaScopeContext): boolean {
  return (
    auth.isApiKey === true &&
    auth.personaIds !== null &&
    auth.personaIds !== undefined
  );
}

//---------------
// isPersonaAllowed — checks whether an authenticated context can access the
// persona. null/undefined scope = full access (web session or a key without
// restriction); an explicit list = only the IDs it contains.
//---------------
export function isPersonaAllowed(
  scope: readonly string[] | null | undefined,
  personaId: string,
): boolean {
  if (scope === null || scope === undefined) return true;
  return scope.includes(personaId);
}
