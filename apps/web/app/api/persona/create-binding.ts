import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { ERROR_CODES } from '@/lib/error-codes';
import { rollbackStoragePath } from '@/lib/persona-photo';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
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
    logger.error('[api/persona] persona binding save failed; rolling back creation', error, { personaId });
    const { error: rollbackError } = await createSupabaseServiceClient()
      .from('personas')
      .delete()
      .eq('id', personaId)
      .eq('user_id', userId);
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
