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
import { ERROR_CODES } from '@/lib/error-codes';
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
): Promise<
  | { ok: true }
  | { ok: false; status: number; code: string; error: string }
> {
  try {
    await setPersonaDefaultAccounts({ supabase, userId, personaId, accounts: binding });
    return { ok: true };
  } catch (error) {
    // The binding never landed (unowned account, DB failure): delete the
    // persona row and its photo, mirroring the library-rollback precedent
    // in the create route — a half-created persona is worse than none.
    // The rollback runs for every failure, but the response keeps the
    // lib's error-code contract: a coded client-input error (unknown
    // provider, unowned account, missing persona) is a 400/404 with the
    // lib's message, exactly like the PUT route maps it — only a genuine
    // DB failure (uncoded) is a 500 with the generic message.
    logger.error('[api/persona] persona binding save failed; rolling back creation', error, { personaId });
    const { error: rollbackError } = await supabase.from('personas').delete().eq('id', personaId);
    if (rollbackError) {
      logger.error('[api/persona] creation rollback failed after binding save', rollbackError);
    }
    await rollbackStoragePath(supabase, photoPathToRollback);
    const code = (error as { code?: string } | null)?.code;
    if (code === ERROR_CODES.PERSONA_NOT_FOUND) {
      return { ok: false, status: 404, code, error: error instanceof Error ? error.message : 'Persona not found.' };
    }
    if (code === ERROR_CODES.INVALID_PROVIDER_ACCOUNT || code === ERROR_CODES.VALIDATION_FAILED) {
      return { ok: false, status: 400, code, error: error instanceof Error ? error.message : 'Failed to bind publishing accounts to the persona.' };
    }
    return { ok: false, status: 500, code: ERROR_CODES.INTERNAL_ERROR, error: 'Failed to bind publishing accounts to the persona.' };
  }
}
