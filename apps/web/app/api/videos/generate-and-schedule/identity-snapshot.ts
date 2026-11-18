//---------------
// Identity snapshot for the schedules insert (migration 012).
//
// The engine reads these at tick time through post_identity, and they are
// the values this request was priced with — writing them here is what
// makes a scheduled post reproducible when the persona is edited (or
// deleted) afterwards. The CTA rides as its intent (issue #639): type
// plus facts, never wording — a later persona edit must not rewrite
// what this video was scheduled with.
//---------------

import type { PersonaPrep } from './persona-prep';
import type { ResolvedCta } from './cta-validation';

/** Build the priced-identity fields of a schedules row. */
export function buildIdentitySnapshot(
  prep: PersonaPrep,
  audioUrl: string | undefined,
  cta: ResolvedCta | null,
) {
  return {
    post_voice_id: prep.voiceIdValue ?? null,
    // Snapshot the RAW request audioUrl, not the resolved voiceAudioUrl: for
    // a persona-backed post that is a 1-hour signed URL of the persona's
    // voice_audio_path, and snapshotting it would store an expired URL that
    // shadows the fresh re-signing at tick time. The raw URL is only ever a
    // stable remote URL (validated + SSRF-checked above).
    post_voice_audio_url: audioUrl ?? null,
    post_cta_type: cta?.type ?? null,
    post_cta_url: cta?.url ?? null,
    post_cta_instruction: cta?.instruction ?? null,
    post_niche: prep.niche,
    post_language: prep.language,
    post_video_aspect: prep.videoAspect,
    post_video_layout: prep.videoLayout,
    post_paragraph_number: prep.paragraphNumber,
    post_face_quality: prep.faceQuality,
  };
}
