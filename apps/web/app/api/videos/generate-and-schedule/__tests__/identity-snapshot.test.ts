import { describe, it, expect } from 'vitest';

import { buildIdentitySnapshot } from '../identity-snapshot';
import type { PersonaPrep } from '../persona-prep';

//---------------
// buildIdentitySnapshot — the priced identity written onto the schedule
// row. The CTA rides as its intent (issue #639): a later persona edit
// must not rewrite what the video was scheduled with.
//---------------

const PREP = {
  voiceIdValue: 'kokoro:af_heart',
  niche: 'fitness',
  language: 'en-US',
  videoAspect: '9:16',
  videoLayout: 'standard',
  paragraphNumber: 3,
  faceQuality: 'ok',
} as unknown as PersonaPrep;

describe('buildIdentitySnapshot', () => {
  it('snapshots the persona fields and the resolved CTA intent', () => {
    expect(
      buildIdentitySnapshot(PREP, 'https://example.com/voice.mp3', {
        type: 'link',
        url: 'https://example.com/course',
        instruction: null,
      }),
    ).toEqual({
      post_voice_id: 'kokoro:af_heart',
      post_voice_audio_url: 'https://example.com/voice.mp3',
      post_cta_type: 'link',
      post_cta_url: 'https://example.com/course',
      post_cta_instruction: null,
      post_niche: 'fitness',
      post_language: 'en-US',
      post_video_aspect: '9:16',
      post_video_layout: 'standard',
      post_paragraph_number: 3,
      post_face_quality: 'ok',
    });
  });

  it('snapshots nulls when there is no voice, no audio URL and no CTA', () => {
    const faceless = { ...PREP, voiceIdValue: null, niche: null, language: null, videoAspect: null, videoLayout: null, paragraphNumber: null, faceQuality: null } as unknown as PersonaPrep;
    expect(buildIdentitySnapshot(faceless, undefined, null)).toEqual({
      post_voice_id: null,
      post_voice_audio_url: null,
      post_cta_type: null,
      post_cta_url: null,
      post_cta_instruction: null,
      post_niche: null,
      post_language: null,
      post_video_aspect: null,
      post_video_layout: null,
      post_paragraph_number: null,
      post_face_quality: null,
    });
  });
});
