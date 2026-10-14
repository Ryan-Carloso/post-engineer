// Persona prep for a post without a persona.
//
// Extracted from route.ts so the route module stays under the file-size
// ratchet. PersonaPrep is the snapshot the engine reads at tick time.
import type { FaceQuality } from '@/lib/tokens';

export interface PersonaPrep {
  personaName: string;
  /** Per-post "no face" choice (options.faceless). */
  faceless: boolean;
  faceQuality: FaceQuality;
  voiceAudioUrl?: string;
  voiceIdValue?: string;
  avatarUrl: string | null;
  photoPath: string | null;
  niche: string | null;
  scriptPrompt: string | null;
  language: string | null;
  videoAspect: string | null;
  videoLayout: string | null;
  paragraphNumber: number | null;
  photoRequired: boolean;
}

//---------------
// resolvePostWithoutPersona — a faceless post defined entirely by the
// request. Everything the engine reads off a persona is supplied here and
// snapshotted; the caller already refused a persona-less post that is not
// faceless or that carries no voice.
//---------------
export function resolvePostWithoutPersona(opts: {
  faceless: boolean;
  audioUrl?: string;
  voiceId?: string;
  scriptPrompt?: string;
  videoAspect?: '9:16' | '16:9';
  videoLayout?: 'standard' | 'react';
  paragraphNumber?: number;
  language?: string;
  niche?: string;
}): PersonaPrep {
  return {
    // The display name for the notification; a persona-less post has no
    // persona name, so it is identified by its own shape.
    personaName: 'Post',
    faceless: true,
    // No persona to price: a faceless post ignores face quality, and this is
    // the same value the engine's token_cost reads off the snapshot.
    faceQuality: 'ok',
    voiceAudioUrl: opts.audioUrl,
    voiceIdValue: opts.voiceId,
    avatarUrl: null,
    photoPath: null,
    niche: opts.niche ?? null,
    scriptPrompt: opts.scriptPrompt ?? null,
    language: opts.language ?? null,
    videoAspect: opts.videoAspect ?? null,
    videoLayout: opts.videoLayout ?? null,
    paragraphNumber: opts.paragraphNumber ?? null,
    photoRequired: false,
  };
}
