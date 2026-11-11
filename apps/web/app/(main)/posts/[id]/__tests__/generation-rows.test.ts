import { describe, it, expect } from 'vitest';
import { buildGenerationRows } from '../generation-rows';
import { narrowGeneration } from '@/lib/slot-detail';

const t = (key: string): string => key;

describe('buildGenerationRows', () => {
  it('shows persona and face, with no material row: every video is the agent images', () => {
    const rows = buildGenerationRows({ ...narrowGeneration(null), material: 'images' }, 'Ana', t);
    expect(rows).toEqual([
      { label: 'posts.generationPersonaLabel', value: 'Ana' },
      { label: 'posts.generationFaceLabel', value: 'posts.generationWithFace' },
    ]);
  });

  it('keeps the optional facts after the face', () => {
    const rows = buildGenerationRows(
      { ...narrowGeneration(null), faceless: true, language: 'en-US', paragraphNumber: 3 },
      'Ana',
      t,
    );
    expect(rows.map((r) => r.value)).toEqual(['Ana', 'posts.generationFaceless', 'en-US', '3']);
  });
});
