import { describe, it, expect } from 'vitest';
import { buildGenerateJobRequest } from '../job-request';

describe('buildGenerateJobRequest', () => {
  it('maps the title, script, options and slot ids into the engine request', () => {
    const request = buildGenerateJobRequest({
      title: 'Porto trip',
      description: 'Agent description.',
      validatedOptions: { videoType: 'voiceover', musicMood: 'calm', webhookUrl: 'https://example.com/hook' },
      segmentsScript: 'Stop scrolling.',
      ctaType: 'save',
      generationId: 'gen-1',
      slotId: 'slot-1',
      segments: [{ kind: 'hook' as const, text: 'Stop scrolling.' }],
    });
    expect(request).toMatchObject({
      video_title: 'Porto trip',
      video_description: 'Agent description.',
      video_type: 'voiceover',
      video_script: 'Stop scrolling.',
      music_mood: 'calm',
      webhook_url: 'https://example.com/hook',
      cta_type: 'save',
      generation_id: 'gen-1',
      slot_id: 'slot-1',
      segments: [{ kind: 'hook', text: 'Stop scrolling.' }],
    });
  });

  it('carries the pacing knobs when given', () => {
    const request = buildGenerateJobRequest({
      title: 'Porto trip',
      description: 'Agent description.',
      validatedOptions: {
        videoType: 'hook_lipsync',
        videoClipDuration: 4,
        videoTransitionMode: 'Crossfade',
        videoVariationSeed: 7,
      },
      segmentsScript: 'Stop scrolling.',
      ctaType: null,
      generationId: 'gen-1',
      slotId: 'slot-1',
      segments: [{ kind: 'hook' as const, text: 'Stop scrolling.' }],
    });
    expect(request.video_clip_duration).toBe(4);
    expect(request.video_transition_mode).toBe('Crossfade');
    expect(request.video_variation_seed).toBe(7);
  });

  it('leaves the pacing knobs undefined when omitted, like the inline literal did', () => {
    const request = buildGenerateJobRequest({
      title: 'Porto trip',
      description: 'Agent description.',
      validatedOptions: { videoType: 'voiceover' },
      segmentsScript: 'Stop scrolling.',
      ctaType: null,
      generationId: 'gen-1',
      slotId: 'slot-1',
      segments: [{ kind: 'hook' as const, text: 'Stop scrolling.' }],
    });
    expect(request.video_clip_duration).toBeUndefined();
    expect(request.video_transition_mode).toBeUndefined();
    expect(request.video_variation_seed).toBeUndefined();
  });
});
