import type { SupabaseClient } from '@supabase/supabase-js';

import { logger } from '@/lib/logger';
import { IMAGE_BUCKET, IMAGE_URL_TTL_SECONDS } from '@/lib/persona-images';

export async function signImageUrl(
  supabase: SupabaseClient,
  imagePath: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from(IMAGE_BUCKET)
      .createSignedUrl(imagePath, IMAGE_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      logger.warn('[api/persona/images] failed to sign storage URL', { imagePath, error });
      return null;
    }
    return data.signedUrl;
  } catch (error) {
    logger.warn('[api/persona/images] failed to sign storage URL', { imagePath, error });
    return null;
  }
}
