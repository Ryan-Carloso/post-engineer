import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { hashShareToken, isShareTokenShape } from './token';
import type { ShareScope } from './share-view';

const LAST_VIEWED_REFRESH_MS = 5 * 60 * 1000;

export interface ActiveShareLink extends ShareScope {
  id: string;
}

function narrowPersonaIds(value: unknown): string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function isActive(row: Record<string, unknown>, now: Date): boolean {
  if (row.revoked_at !== null) return false;
  if (row.expires_at === null) return true;
  if (typeof row.expires_at !== 'string') return false;
  const expiresAt = Date.parse(row.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
}

export async function findActiveShareLink(
  supabase: SupabaseClient,
  token: string,
  now: Date,
): Promise<ActiveShareLink | null> {
  if (!isShareTokenShape(token)) return null;
  const { data, error } = await supabase
    .from('share_links')
    .select('id, user_id, persona_ids, expires_at, revoked_at')
    .eq('token_hash', hashShareToken(token))
    .maybeSingle();
  if (error) throw new Error(`share link lookup failed: ${error.message}`);
  if (data === null || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.user_id !== 'string') return null;
  if (!isActive(row, now)) return null;
  return { id: row.id, userId: row.user_id, personaIds: narrowPersonaIds(row.persona_ids) };
}

export async function touchShareLink(supabase: SupabaseClient, id: string, now: Date): Promise<void> {
  const stale = new Date(now.getTime() - LAST_VIEWED_REFRESH_MS).toISOString();
  const { error } = await supabase
    .from('share_links')
    .update({ last_viewed_at: now.toISOString() })
    .eq('id', id)
    .or(`last_viewed_at.is.null,last_viewed_at.lt.${stale}`);
  if (error) logger.warn('[share-links] last_viewed_at update failed', { message: error.message });
}
