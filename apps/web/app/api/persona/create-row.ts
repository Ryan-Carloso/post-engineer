import type { ParsedPersonaForm } from '@/lib/persona-schema';
import type { Database } from '@/lib/supabase/database.gen';

type PersonaInsert = Database['public']['Tables']['personas']['Insert'];

export interface PersonaInsertInput {
  personaId: string;
  userId: string;
  photoPath: string | null;
  values: ParsedPersonaForm['values'];
}

export function buildPersonaInsertRow(input: PersonaInsertInput): PersonaInsert {
  const { values } = input;
  return {
    id: input.personaId,
    user_id: input.userId,
    name: values.name.trim(),
    photo_path: input.photoPath,
    identity_card: values.identityCard,
  };
}
