import { describe, it, expect } from 'vitest';
import { buildGenerationRows } from '../generation-rows';
import { narrowGeneration } from '@/lib/slot-detail';

const t = (key: string): string => key;

describe('buildGenerationRows', () => {
  it('always shows the material, right after the face', () => {
    const rows = buildGenerationRows({ ...narrowGeneration(null), material: 'svg' }, 'Ana', t);
    expect(rows.slice(0, 3)).toEqual([
      { label: 'posts.generationPersonaLabel', value: 'Ana' },
      { label: 'posts.generationFaceLabel', value: 'posts.generationWithFace' },
      { label: 'posts.generationMaterialLabel', value: 'posts.generationMaterialSvg' },
    ]);
    expect(rows).toHaveLength(3);
  });

  it('labels stock material and keeps the optional facts after it', () => {
    const rows = buildGenerationRows(
      { ...narrowGeneration(null), faceless: true, language: 'en-US', paragraphNumber: 3 },
      'Ana',
      t,
    );
    expect(rows.map((r) => r.value)).toEqual([
      'Ana',
      'posts.generationFaceless',
      'posts.generationMaterialBroll',
      'en-US',
      '3',
    ]);
  });
});
