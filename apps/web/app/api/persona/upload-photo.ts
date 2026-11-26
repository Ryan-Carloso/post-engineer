import type { SupabaseClient } from '@supabase/supabase-js';
import { PERSONA_PHOTO_BUCKET, personaAssetPath } from '@/lib/persona-photo';
import { logger } from '@/lib/logger';

export async function uploadFile(
  supabase: SupabaseClient,
  userId: string,
  personaId: string,
  file: File,
  extension: string,
): Promise<string | null> {
  const path = personaAssetPath(userId, personaId, `photo.${extension}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await supabase.storage.from(PERSONA_PHOTO_BUCKET).upload(path, bytes, {
    contentType: file.type,
  });

  if (error) {
    logger.error('[api/persona] storage upload failed', error, { path });
    return null;
  }
  return path;
}
