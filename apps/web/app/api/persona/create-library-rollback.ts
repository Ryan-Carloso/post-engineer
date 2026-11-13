//---------------
// create-library-rollback — roll back a persona creation whose library
// images failed to save, so a half-written persona never survives.
//
// Lives here (not in route.ts) so the route module stays under the
// file-size ratchet. The orchestration is route-specific: orphan paths
// are retried BEFORE the persona delete (its cascade erases the image
// rows, making failed removals unrecoverable), while row-backed paths
// are removed only AFTER a successful delete, when the rows are gone
// and the files are true orphans.
//---------------

import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import {
  IMAGE_BUCKET,
  removeOrphanedUploadPaths,
  type LibraryImagesError,
} from '@/lib/persona-images';
import { rollbackStoragePath } from '@/lib/persona-remote-face';
import { forwardLibraryImagesError } from './validation-error';

export async function rollbackLibraryCreation(
  supabase: SupabaseClient,
  personaId: string,
  photoPathToRollback: string | null,
  added: LibraryImagesError,
): Promise<NextResponse> {
  // Rollback failures are logged loudly: an invisible failed rollback is
  // worse than a loud one.
  const { orphanPaths, rowBackedPaths } = added.leftoverPaths ?? {
    orphanPaths: [],
    rowBackedPaths: [],
  };
  if (orphanPaths.length > 0) {
    // Retry the orphan removal once via the shared helper (logs loudly
    // on failure); row-backed orchestration below is route-specific.
    await removeOrphanedUploadPaths(supabase, orphanPaths, {
      route: 'api/persona',
    });
  }
  const { error: rollbackError } = await supabase
    .from('personas')
    .delete()
    .eq('id', personaId);
  if (rollbackError) {
    logger.error('[api/persona] creation rollback failed', rollbackError);
    if (rowBackedPaths.length > 0) {
      // Rows survive, so their storage files must survive too: removing
      // them would leave rows pointing at deleted objects.
      logger.error('[api/persona] creation rollback failed; row-backed image files left in place', undefined, { rowBackedPaths });
    }
  } else if (rowBackedPaths.length > 0) {
    // The cascade erased the image rows: their storage files are now
    // true orphans. One retry, then loud logging — the rows are gone,
    // so this is the last recovery chance.
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
