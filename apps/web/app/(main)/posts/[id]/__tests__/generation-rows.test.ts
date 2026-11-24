import { describe, it, expect } from 'vitest';
import { buildGenerationRows } from '../generation-rows';
import { narrowGeneration } from '@/lib/slot-detail';

const t = (key: string): string => key;

describe('buildGenerationRows', () => {
  it('shows persona and face, with no material row: every video is the agent images', () => {
    const rows = buildGenerationRows(narrowGeneration(null), 'Ana', t);
    expect(rows).toEqual([
      { label: 'posts.generationPersonaLabel', value: 'Ana' },
      { label: 'posts.generationFaceLabel', value: 'posts.generationWithFace' },
    ]);
  });

  it('keeps the optional facts after the face', () => {
    const rows = buildGenerationRows(
      { ...narrowGeneration(null), voiceover: true, language: 'en-US', paragraphNumber: 3 },
      'Ana',
      t,
    );
    expect(rows.map((r) => r.value)).toEqual(['Ana', 'posts.generationVoiceover', 'en-US', '3']);
  });

  it('names the prompt version first when the video recorded one', () => {
    const rows = buildGenerationRows(
      { ...narrowGeneration(null), prompt: { slug: 'story-first', title: 'Story first', version: 3, source: 'official' } },
      'Ana',
      t,
    );
    expect(rows[0]).toEqual({ label: 'postPrompt.label', value: 'Story first · v3' });
    expect(rows[1]).toEqual({ label: 'posts.generationPersonaLabel', value: 'Ana' });
  });
});
