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
