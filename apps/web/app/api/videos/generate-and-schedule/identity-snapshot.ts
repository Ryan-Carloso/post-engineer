import type { PersonaPrep } from './persona-prep';
import type { ResolvedCta } from './cta-validation';

export function buildIdentitySnapshot(
  prep: PersonaPrep,
  audioUrl: string | undefined,
  cta: ResolvedCta | null,
) {
  return {
    post_voice_id: prep.voiceIdValue ?? null,
    post_voice_audio_url: audioUrl ?? null,
    post_cta_type: cta?.type ?? null,
    post_cta_url: cta?.url ?? null,
    post_cta_instruction: cta?.instruction ?? null,
    post_niche: prep.niche,
    post_language: prep.language,
    post_video_aspect: prep.videoAspect,
    post_video_layout: prep.videoLayout,
    post_hook_panel: prep.hookPanel,
    post_paragraph_number: prep.paragraphNumber,
    post_face_quality: prep.faceQuality,
  };
}
