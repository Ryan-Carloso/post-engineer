import { createHash, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

const KEY_PREFIX = 'pe_live_';
const MIN_KEY_LENGTH = 32;
export const API_KEY_LAST_USED_TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export const APPROVAL_MODES = ['yolo', 'approval'] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return value === 'yolo' || value === 'approval';
}

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
    .select('id, user_id, persona_ids, revoked_at, last_used_at')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .single();

  if (error || !data) {
    return null;
  }

  await touchApiKeyLastUsed(supabase, data.id as string, data.last_used_at);

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

function isLastUsedStale(lastUsedAt: unknown, cutoffMs: number): boolean {
  if (typeof lastUsedAt !== 'string') return true;
  const lastUsedMs = Date.parse(lastUsedAt);
  return Number.isNaN(lastUsedMs) || lastUsedMs < cutoffMs;
}

async function touchApiKeyLastUsed(
  supabase: SupabaseClient,
  keyId: string,
  lastUsedAt: unknown,
): Promise<void> {
  const nowMs = Date.now();
  const cutoffMs = nowMs - API_KEY_LAST_USED_TOUCH_INTERVAL_MS;
  if (!isLastUsedStale(lastUsedAt, cutoffMs)) return;
  const cutoff = new Date(cutoffMs).toISOString();
  const { error } = await supabase
    .from('user_api_keys')
    .update({ last_used_at: new Date(nowMs).toISOString() })
    .eq('id', keyId)
    .or(`last_used_at.is.null,last_used_at.lt.${cutoff}`);
  if (error) {
    logger.warn('[api-keys] last_used_at touch failed', {
      keyId,
      code: error.code,
      message: error.message,
    });
  }
}

export interface PersonaScopeContext {
  isApiKey?: boolean;
  personaIds?: string[] | null;
}

export function isScopedApiKey<T extends PersonaScopeContext>(
  auth: T,
): auth is T & { isApiKey: true; personaIds: string[] } {
  return (
    auth.isApiKey === true &&
    auth.personaIds !== null &&
    auth.personaIds !== undefined
  );
}

export function isPersonaAllowed(
  scope: readonly string[] | null | undefined,
  personaId: string,
): boolean {
  if (scope === null || scope === undefined) return true;
  return scope.includes(personaId);
}
