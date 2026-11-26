import type { ParsedPersonaForm } from '@/lib/persona-schema';
import type { Database } from '@/lib/supabase/database.gen';

type PersonaInsert = Database['public']['Tables']['personas']['Insert'];

export type PersonaPreferenceColumns = Pick<
  PersonaInsert,
  | 'language'
  | 'video_aspect'
  | 'video_layout'
  | 'hook_panel'
  | 'ai_label'
  | 'script_prompt'
  | 'cta_type'
  | 'cta_url'
  | 'cta_instruction'
  | 'paragraph_number'
  | 'niche'
  | 'face_quality'
>;

export function personaPreferenceColumns(values: ParsedPersonaForm['values']): PersonaPreferenceColumns {
  return {
    language: values.language,
    video_aspect: values.videoAspect,
    video_layout: values.videoLayout,
    hook_panel: values.hookPanel ?? true,
    ai_label: values.aiLabel ?? false,
    script_prompt: values.scriptPrompt,
    cta_type: values.ctaType,
    cta_url: values.ctaUrl,
    cta_instruction: values.ctaInstruction,
    paragraph_number: values.paragraphNumber,
    niche: values.niche,
    face_quality: values.faceQuality,
  };
}
