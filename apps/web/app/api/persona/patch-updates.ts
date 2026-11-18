import type { Database } from '@/lib/supabase/database.gen';
import type { PersonaPatchBody } from './patch-body';

type PersonaUpdate = Database['public']['Tables']['personas']['Update'];

export function applyPersonaPatchFields(
  patch: PersonaPatchBody,
  updates: PersonaUpdate,
): void {
  if (patch.language !== null) updates.language = patch.language;
  if (patch.videoAspect !== null) updates.video_aspect = patch.videoAspect;
  if (patch.videoLayout !== null) updates.video_layout = patch.videoLayout;
  if (patch.scriptPrompt !== null) updates.script_prompt = patch.scriptPrompt;
  if (patch.ctaText !== null) updates.cta_text = patch.ctaText;
  if (patch.paragraphNumber !== null) updates.paragraph_number = patch.paragraphNumber;
  if (patch.niche !== null) updates.niche = patch.niche;
  if (patch.faceQuality !== null) updates.face_quality = patch.faceQuality;
}
