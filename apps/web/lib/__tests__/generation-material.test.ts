import { describe, it, expect } from 'vitest';
import { buildGenerationFacts } from '@/lib/generation-facts';
import { narrowGeneration } from '@/lib/slot-detail';

//---------------
// The post's material (scheduled_posts.faceless_material, migration 029)
// is part of its generation record. Only 'images' counts, on both the
// server read and the client narrow — the same rule as the engine's
// slot_material, so every row reads as the images material since
// migration 054 backfilled them.
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
  it('reads images from the slot row', () => {
    expect(buildGenerationFacts({ faceless: true, faceless_material: 'images' }, scheduleRow).material).toBe('images');
  });

  it('reads anything else, or a missing column, as images', () => {
    for (const value of ['broll', 'svg', null, 'SVG', 'IMAGES', 'image', '']) {
      expect(buildGenerationFacts({ faceless: true, faceless_material: value }, scheduleRow).material).toBe('images');
    }
    expect(buildGenerationFacts({ faceless: true }, scheduleRow).material).toBe('images');
  });

  it('narrows the payload material with the same literal rule', () => {
    expect(narrowGeneration({ material: 'images' }).material).toBe('images');
    expect(narrowGeneration({ material: 'svg' }).material).toBe('images');
    expect(narrowGeneration({ material: 'drawings' }).material).toBe('images');
    expect(narrowGeneration(null).material).toBe('images');
  });
});
