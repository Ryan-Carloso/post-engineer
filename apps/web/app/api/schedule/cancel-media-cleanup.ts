//---------------
// Cancel media cleanup (issue #384): a scheduled image stores its bytes
// in the `uploads` bucket at the slot's media_ref path. Cancelling the
// schedule deletes the slot rows first; the objects follow, best-effort —
// a removal failure is logged loudly and never fails the cancel (the
// caller already got its slots deleted). Ownership was established by the
// user_id-filtered slot select in the route, so the service client deletes
// exactly those paths.
//---------------

import type { SupabaseClient } from '@supabase/supabase-js';

import { logger } from '@/lib/logger';
import type { ScheduleCancelSlot } from './cancel-slots';

export async function removeCancelledMediaImages(
  serviceClient: SupabaseClient,
  removedSlots: ScheduleCancelSlot[],
): Promise<void> {
  const paths: string[] = [];
  for (const slot of removedSlots) {
    if (slot.mediaKind === 'image' && slot.mediaRef !== null) paths.push(slot.mediaRef);
  }
  if (paths.length === 0) return;
  const { error } = await serviceClient.storage.from('uploads').remove(paths);
  if (error) {
    logger.error('[api/schedule] cancel could not remove stored images', error, { paths });
  }
}
