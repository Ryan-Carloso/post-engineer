// Scalar PATCH field application for the persona route.
//
// Extracted from route.ts so the route module stays under the file-size
// ratchet. Every field is optional on edit; only present fields land in
// `updates`, so an untouched field keeps its stored value.

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
  // Face quality is a plain scalar like the rest: changing it only rewrites
  // the persona row. Already-created schedules keep the snapshot they were
  // charged for (post_face_quality); new schedules and direct videos read
  // the persona row, so they price at the new quality.
  if (patch.faceQuality !== null) updates.face_quality = patch.faceQuality;
}
