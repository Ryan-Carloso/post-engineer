//---------------
// Persona list JSON shape. Lives here so apps/web/lib/api.ts (grandfathered
// over the 500-line cap) can add libraryUrl without growing.
//---------------

import type { PersonaDefaultAccounts } from './persona-publishing-accounts';

export interface PersonaRecord {
  id: string;
  name: string;
  createdAt: string;
  avatarUrl?: string;
  photoUrl?: string;
  /** Signed library face used only as a display fallback. Never image_path. */
  libraryUrl?: string;
  voiceId?: string;
  voiceAudioUrl?: string;
  language?: string;
  videoAspect?: string;
  videoLayout?: string;
  scriptPrompt?: string;
  // The persona's CTA intent (issue #639): a type plus facts, never wording.
  ctaType?: string;
  ctaUrl?: string;
  ctaInstruction?: string;
  paragraphNumber?: number;
  niche?: string;
  // Billing input for the per-video token cost estimate (the persona's face
  // quality; "no face" is a per-post choice, not a persona attribute).
  faceQuality?: string;
  // Issue #572: the accounts this persona is bound to, per provider
  // (persona_default_accounts). Absent on records from before the binding
  // shipped; the card treats absent as unbound so a legacy persona is
  // never silently shown as publishing everywhere.
  boundAccounts?: PersonaDefaultAccounts;
}
