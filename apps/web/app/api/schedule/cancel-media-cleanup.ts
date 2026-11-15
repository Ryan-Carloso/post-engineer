//---------------
// Cancel media cleanup (issue #384): a scheduled image stores its bytes
// in the `uploads` bucket at the slot's media_ref path. Cancelling the
// schedule deletes the slot rows first; the objects follow, best-effort —
// a removal failure is logged loudly and never fails the cancel (the
// caller already got its slots deleted). Ownership covers the object path
// too, not just the slot row: only a path under this user's own
// `scheduled-media/<user_id>/` prefix is ever removed, and dot segments
// are rejected — a corrupted or foreign media_ref must never make the
// service client delete another user's object.
//---------------

import type { SupabaseClient } from '@supabase/supabase-js';

import { logger } from '@/lib/logger';
import type { ScheduleCancelSlot } from './cancel-slots';

export async function removeCancelledMediaImages(
  serviceClient: SupabaseClient,
  removedSlots: ScheduleCancelSlot[],
  userId: string,
): Promise<void> {
  const prefix = `scheduled-media/${userId}/`;
  const paths: string[] = [];
  for (const slot of removedSlots) {
    if (slot.mediaKind !== 'image' || slot.mediaRef === null) continue;
    const ref = slot.mediaRef;
    if (!ref.startsWith(prefix)) continue;
    if (ref.split('/').some((part) => part === '' || part === '.' || part === '..')) continue;
    paths.push(ref);
  }
  if (paths.length === 0) return;
  const { error } = await serviceClient.storage.from('uploads').remove(paths);
  if (error) {
    logger.error('[api/schedule] cancel could not remove stored images', error, { paths });
  }
}
