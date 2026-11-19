import type { SupabaseClient } from '@supabase/supabase-js';
import { IMAGE_BUCKET, personaAssetPath } from '@/lib/persona-images';
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
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, bytes, {
    contentType: file.type,
  });

  if (error) {
    logger.error('[api/persona] storage upload failed', error, { path });
    return null;
  }
  return path;
}
