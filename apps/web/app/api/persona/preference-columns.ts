import type { ParsedPersonaForm } from '@/lib/persona-schema';
import type { Database } from '@/lib/supabase/database.gen';

type PersonaInsert = Database['public']['Tables']['personas']['Insert'];

export type PersonaPreferenceColumns = Pick<PersonaInsert, 'ai_label'>;

export function personaPreferenceColumns(values: ParsedPersonaForm['values']): PersonaPreferenceColumns {
  return {
    ai_label: values.aiLabel ?? false,
  };
}
