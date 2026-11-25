import type { ParsedPersonaForm } from '@/lib/persona-schema';
import type { Database } from '@/lib/supabase/database.gen';
import { personaPreferenceColumns } from './preference-columns';

type PersonaInsert = Database['public']['Tables']['personas']['Insert'];

export interface PersonaInsertInput {
  personaId: string;
  userId: string;
  photoPath: string | null;
  avatarUrl: string | null;
  values: ParsedPersonaForm['values'];
}

export function buildPersonaInsertRow(input: PersonaInsertInput): PersonaInsert {
  const { values } = input;
  return {
    id: input.personaId,
    user_id: input.userId,
    name: (values.name ?? '').trim(),
    photo_path: input.photoPath,
    avatar_url: input.avatarUrl,
    voice_id: values.voiceId,
    ...personaPreferenceColumns(values),
    identity_card: values.identityCard,
    recent_image_ids: [],
  };
}
