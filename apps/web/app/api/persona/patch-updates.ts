// Scalar PATCH field application for the persona route.
//
// Extracted from route.ts so the route module stays under the file-size
// ratchet. Every field is optional on edit; only present fields land in
// `updates`, so an untouched field keeps its stored value.

import { PERSONA_CTA_TYPES, validateCtaCoherence } from '@/lib/persona-schema';
import type { PersonaCtaType } from '@/lib/contracts/personas';
import type { Database } from '@/lib/supabase/database.gen';
import type { PersonaPatchBody } from './patch-body';

type PersonaUpdate = Database['public']['Tables']['personas']['Update'];

/** The stored CTA columns the PATCH handler reads for merged-row checks. */
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
  if (patch.language !== null) updates.language = patch.language;
  if (patch.videoAspect !== null) updates.video_aspect = patch.videoAspect;
  if (patch.videoLayout !== null) updates.video_layout = patch.videoLayout;
  if (patch.scriptPrompt !== null) updates.script_prompt = patch.scriptPrompt;
  if (patch.ctaType !== null) updates.cta_type = patch.ctaType;
  if (patch.ctaUrl !== null) updates.cta_url = patch.ctaUrl;
  if (patch.ctaInstruction !== null) updates.cta_instruction = patch.ctaInstruction;
  if (patch.paragraphNumber !== null) updates.paragraph_number = patch.paragraphNumber;
  if (patch.niche !== null) updates.niche = patch.niche;
  // Face quality is a plain scalar like the rest: changing it only rewrites
  // the persona row. Already-created schedules keep the snapshot they were
  // charged for (post_face_quality); new schedules and direct videos read
  // the persona row, so they price at the new quality.
  if (patch.faceQuality !== null) updates.face_quality = patch.faceQuality;
  return resolveMergedCta(patch, stored, updates);
}

// Merged-row CTA coherence (issue #639): the patch is validated against
// the row it will produce, not against the fields it carries alone. A
// patch that sends only `ctaType: 'comment'` on a link persona must clear
// the stored URL, and a patch that sends only `ctaUrl` is checked against
// the stored type — otherwise the row would violate PersonaCtaSchema
// while every per-field rule stayed green. Returns the rejection message,
// or null when the merged row is coherent.
function resolveMergedCta(
  patch: PersonaPatchBody,
  stored: StoredPersonaCta,
  updates: PersonaUpdate,
): string | null {
  const touchesCta = patch.ctaType !== null || patch.ctaUrl !== null || patch.ctaInstruction !== null;
  if (!touchesCta) return null;
  const storedType: PersonaCtaType | null = typeof stored.cta_type === 'string'
    && (PERSONA_CTA_TYPES as readonly string[]).includes(stored.cta_type)
    ? stored.cta_type as PersonaCtaType
    : null;
  const mergedType = patch.ctaType ?? storedType;
  const typeChanged = patch.ctaType !== null && patch.ctaType !== stored.cta_type;
  // A type change drops the stored facts the new type cannot carry; a fact
  // the patch itself provides is always the patch value.
  const urlSurvives = !typeChanged || mergedType === 'link' || mergedType === 'buy';
  const instructionSurvives = !typeChanged || mergedType === 'other';
  const mergedUrl = patch.ctaUrl !== null ? patch.ctaUrl : (urlSurvives ? (stored.cta_url ?? null) : null);
  const mergedInstruction = patch.ctaInstruction !== null
    ? patch.ctaInstruction
    : (instructionSurvives ? (stored.cta_instruction ?? null) : null);
  if (typeChanged) {
    if (!urlSurvives && patch.ctaUrl === null && typeof stored.cta_url === 'string' && stored.cta_url.length > 0) {
      updates.cta_url = '';
    }
    if (!instructionSurvives && patch.ctaInstruction === null && typeof stored.cta_instruction === 'string' && stored.cta_instruction.length > 0) {
      updates.cta_instruction = '';
    }
  }
  return validateCtaCoherence(mergedType, mergedUrl, mergedInstruction);
}
