import type { Database } from '@/lib/supabase/database.gen';
import type { PersonaPatchBody } from './patch-body';

type PersonaUpdate = Database['public']['Tables']['personas']['Update'];

export interface StoredPersonaCta {
  cta_type?: string | null;
  cta_url?: string | null;
  cta_instruction?: string | null;
}

export function applyPersonaPatchFields(
  patch: PersonaPatchBody,
  updates: PersonaUpdate,
  stored: StoredPersonaCta,
): string | null {
  void stored;
  if (patch.aiLabel !== null) updates.ai_label = patch.aiLabel;
  if (patch.identityCard.status === 'set') updates.identity_card = patch.identityCard.card;
  if (patch.identityCard.status === 'clear') updates.identity_card = null;
  return null;
}
