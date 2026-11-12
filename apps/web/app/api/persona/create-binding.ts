//---------------
// create-binding — save the persona's bound publishing accounts right
// after the persona row lands (issue #572), and roll the whole creation
// back when the save fails: a persona with no binding must not survive.
//
// Lives here (not in route.ts) so the route module stays under the
// file-size ratchet.
//---------------

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { rollbackStoragePath } from '@/lib/persona-remote-face';
import {
  setPersonaDefaultAccounts,
  type PersonaDefaultAccounts,
} from '@/lib/persona-publishing-accounts';

export async function savePersonaBinding(
  supabase: SupabaseClient,
  userId: string,
  personaId: string,
  binding: PersonaDefaultAccounts,
  photoPathToRollback: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await setPersonaDefaultAccounts({ supabase, userId, personaId, accounts: binding });
    return { ok: true };
  } catch (error) {
    // The binding never landed (unowned account, DB failure): delete the
    // persona row and its photo, mirroring the library-rollback precedent
    // in the create route — a half-created persona is worse than none.
    logger.error('[api/persona] persona binding save failed; rolling back creation', error, { personaId });
    const { error: rollbackError } = await supabase.from('personas').delete().eq('id', personaId);
    if (rollbackError) {
      logger.error('[api/persona] creation rollback failed after binding save', rollbackError);
    }
    await rollbackStoragePath(supabase, photoPathToRollback);
    return { ok: false, error: 'Failed to bind publishing accounts to the persona.' };
  }
}
