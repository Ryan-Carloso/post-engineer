import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  IMAGE_BUCKET,
  removeOrphanedUploadPaths,
  type LibraryImagesError,
} from '@/lib/persona-images';
import { rollbackStoragePath } from '@/lib/persona-remote-face';
import { forwardLibraryImagesError } from './validation-error';

export async function rollbackLibraryCreation(
  supabase: SupabaseClient,
  userId: string,
  personaId: string,
  photoPathToRollback: string | null,
  added: LibraryImagesError,
): Promise<NextResponse> {
  const { orphanPaths, rowBackedPaths } = added.leftoverPaths ?? {
    orphanPaths: [],
    rowBackedPaths: [],
  };
  if (orphanPaths.length > 0) {
    await removeOrphanedUploadPaths(supabase, orphanPaths, {
      route: 'api/persona',
    });
  }
  const { error: rollbackError } = await createSupabaseServiceClient()
    .from('personas')
    .delete()
    .eq('id', personaId)
    .eq('user_id', userId);
  if (rollbackError) {
    logger.error('[api/persona] creation rollback failed', rollbackError);
    if (rowBackedPaths.length > 0) {
      logger.error('[api/persona] creation rollback failed; row-backed image files left in place', undefined, { rowBackedPaths });
    }
  } else if (rowBackedPaths.length > 0) {
    const { error: rowBackedRemoveError } = await supabase.storage
      .from(IMAGE_BUCKET)
      .remove(rowBackedPaths);
    if (rowBackedRemoveError) {
      const { error: rowBackedRetryError } = await supabase.storage
        .from(IMAGE_BUCKET)
        .remove(rowBackedPaths);
      if (rowBackedRetryError) {
        logger.error('[api/persona] row-backed library storage remove failed after cascade delete', rowBackedRetryError, { rowBackedPaths });
      }
    }
  }
  await rollbackStoragePath(supabase, photoPathToRollback);
  return forwardLibraryImagesError(added, 'POST /api/persona');
}
