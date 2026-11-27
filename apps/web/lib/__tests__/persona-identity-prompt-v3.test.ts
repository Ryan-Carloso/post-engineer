import { describe, expect, it } from 'vitest';
import { buildIdentityPrompt } from '../persona-identity-prompt';
import { FIXTURE_CARD_V3 } from '@/test/identity-card-fixtures';
import type { IdentityCard, Scene } from '@/lib/contracts/persona-identity-card';

const BASE_SCENE: Scene = { lighting: 'golden_hour', framing: 'waist_up' };

function line(prompt: string, prefix: string): string | undefined {
  return prompt.split('\n').find((candidate) => candidate.startsWith(prefix));
}

describe('buildIdentityPrompt for a v3 card', () => {
  it('renders the description as the Person line with its line breaks collapsed', () => {
    const { prompt } = buildIdentityPrompt(FIXTURE_CARD_V3, BASE_SCENE);
    expect(line(prompt, 'Person:')).toBe(
      'Person: Deep-set brown eyes, straight nose, full lips, oval face, dark wavy hair, athletic build.',
    );
  });

  it('keeps a single closing period when the description ends with punctuation', () => {
    const card: IdentityCard = { version: 3, identity: { description: 'green eyes; square jaw.' } };
    const { prompt } = buildIdentityPrompt(card, BASE_SCENE);
    expect(line(prompt, 'Person:')).toBe('Person: green eyes; square jaw.');
  });

  it('renders the card style and the v2 closing line', () => {
    const { prompt } = buildIdentityPrompt(FIXTURE_CARD_V3, BASE_SCENE);
    expect(line(prompt, 'Style:')).toBe('Style: business (tailored suit, formal office wear).');
    expect(prompt.endsWith(
      'Do not change the face, hair, eyes, skin, body build, height, jawline, resting posture or proportions.',
    )).toBe(true);
  });

  it('drops the resting posture clause for a scene with a pose', () => {
    const { prompt } = buildIdentityPrompt(FIXTURE_CARD_V3, { ...BASE_SCENE, pose: 'standing by a window' });
    expect(line(prompt, 'Pose:')).toBe('Pose: standing by a window.');
    expect(prompt).not.toContain('resting posture');
  });

  it('keeps the identity out of the suggested description', () => {
    const { suggestedDescription } = buildIdentityPrompt(FIXTURE_CARD_V3, {
      ...BASE_SCENE,
      setting: 'city street',
    });
    expect(suggestedDescription).toContain('city street');
    expect(suggestedDescription).not.toContain('brown eyes');
    expect(suggestedDescription).not.toContain('wavy hair');
  });

  it('falls back to the keep-outfit line when the card has no style and the scene names none', () => {
    const card: IdentityCard = { version: 3, identity: { description: 'green eyes' } };
    const { prompt } = buildIdentityPrompt(card, BASE_SCENE);
    expect(line(prompt, 'Outfit:')).toBe('Outfit: keep the outfit from the reference photo.');
  });
});
