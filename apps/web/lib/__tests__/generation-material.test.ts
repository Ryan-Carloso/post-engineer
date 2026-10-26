import { describe, it, expect } from 'vitest';
import { buildGenerationFacts } from '@/lib/generation-facts';
import { narrowGeneration } from '@/lib/slot-detail';

//---------------
// The post's material (scheduled_posts.faceless_material, migration 029)
// is part of its generation record. Only the literal 'svg' counts, on both
// the server read and the client narrow — the same rule as the engine's
// slot_material, so a pre-029 row reads as the stock it rendered with.
//---------------
const scheduleRow = {
  post_language: null,
  post_voice_id: null,
  post_video_aspect: null,
  post_video_layout: null,
  post_niche: null,
  post_paragraph_number: null,
  post_face_quality: null,
};

describe('generation material', () => {
  it('reads svg from the slot row', () => {
    expect(buildGenerationFacts({ faceless: false, faceless_material: 'svg' }, scheduleRow).material).toBe('svg');
  });

  it('reads anything else, or a missing column, as broll', () => {
    for (const value of ['broll', null, 'SVG', '']) {
      expect(buildGenerationFacts({ faceless: true, faceless_material: value }, scheduleRow).material).toBe('broll');
    }
    expect(buildGenerationFacts({ faceless: true }, scheduleRow).material).toBe('broll');
  });

  it('narrows the payload material with the same literal rule', () => {
    expect(narrowGeneration({ material: 'svg' }).material).toBe('svg');
    expect(narrowGeneration({ material: 'drawings' }).material).toBe('broll');
    expect(narrowGeneration(null).material).toBe('broll');
  });
});
