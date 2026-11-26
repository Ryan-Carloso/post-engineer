import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

export const PERSONA_PHOTO_BUCKET = 'personas';

export function personaAssetPath(userId: string, personaId: string, fileName: string): string {
  for (const segment of [userId, personaId]) {
    if (segment.length === 0 || segment.includes('/')) {
      throw new Error('personaAssetPath: userId and personaId must be non-empty path segments.');
    }
  }
  if (fileName.length === 0 || fileName.startsWith('/')) {
    throw new Error('personaAssetPath: fileName must be a non-empty relative path.');
  }
  return `${userId}/${personaId}/${fileName}`;
}

export function isFileLike(value: unknown): value is File {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.type === 'string' &&
    typeof candidate.size === 'number' &&
    candidate.arrayBuffer instanceof Function
  );
}

export async function rollbackStoragePath(
  supabase: SupabaseClient,
  path: string | null | undefined,
): Promise<void> {
  if (path === null || path === undefined || path === '') return;
  const { error } = await supabase.storage.from(PERSONA_PHOTO_BUCKET).remove([path]);
  if (error) {
    logger.error('[persona-photo] storage rollback failed', error, { path });
  }
}
