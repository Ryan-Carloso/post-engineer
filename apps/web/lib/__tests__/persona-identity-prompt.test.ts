import { describe, expect, it } from 'vitest';
import type { IdentityCard, Scene } from '@/lib/contracts/persona-identity-card';
import { buildIdentityPrompt } from '../persona-identity-prompt';
import { FIXTURE_CARD, FIXTURE_SCENE } from '@/test/identity-card-fixtures';

function shuffleKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(shuffleKeys) as T;
  if (typeof value !== 'object' || value === null) return value;
  const entries = Object.entries(value).reverse().map(([key, entry]) => [key, shuffleKeys(entry)] as const);
  return Object.fromEntries(entries) as T;
}

const IDENTITY_LEAVES = [
  'oval', 'blue-grey, wide-set', 'straight, medium', 'straight, narrow', 'full, natural pink', 'fair, light freckles',
  'blonde', 'long wavy', 'past shoulders', 'athletic, toned', 'tall', 'narrow', 'slim, no jewelry',
];

describe('buildIdentityPrompt', () => {
  it('renders the full prompt in the fixed line order', () => {
    expect(buildIdentityPrompt(FIXTURE_CARD, FIXTURE_SCENE).prompt).toMatchInlineSnapshot(`
      "Edit the reference photo. Keep the person's face and body exactly as in the reference photo.
      Person: face shape: oval; eyes: blue-grey, wide-set; eyebrows: straight, medium; nose: straight, narrow; lips: full, natural pink; skin: fair, light freckles; hair color: blonde; hair style: long wavy; hair length: past shoulders; body build: athletic, toned; height: tall; shoulders: narrow; hands: slim, no jewelry.
      Outfit: top: navy blazer; bottom: grey trousers; footwear: running shoes.
      Pose: standing, facing camera.
      Setting: city street at golden hour.
      Lighting: golden hour.
      Framing: waist-up shot, 9:16 aspect ratio.
      Do not change the face, hair, eyes, skin, body build or height."
    `);
  });

  it('is byte-identical for the same input', () => {
    const first = buildIdentityPrompt(FIXTURE_CARD, FIXTURE_SCENE);
    const second = buildIdentityPrompt(structuredClone(FIXTURE_CARD), structuredClone(FIXTURE_SCENE));
    expect(second).toEqual(first);
  });

  it('keeps the output stable when the input keys arrive in another order', () => {
    const shuffled = buildIdentityPrompt(shuffleKeys(FIXTURE_CARD), shuffleKeys(FIXTURE_SCENE));
    expect(shuffled).toEqual(buildIdentityPrompt(FIXTURE_CARD, FIXTURE_SCENE));
  });

  it('takes the identity line from the card only', () => {
    const quiet = buildIdentityPrompt(FIXTURE_CARD, { lighting: 'studio', framing: 'close_up' });
    const busy = buildIdentityPrompt(FIXTURE_CARD, { ...FIXTURE_SCENE, setting: 'beach', pose: 'sitting on a rock' });
    const identityLine = (prompt: string) => prompt.split('\n').find((line) => line.startsWith('Person:'));
    expect(identityLine(quiet.prompt)).toBeDefined();
    expect(identityLine(busy.prompt)).toBe(identityLine(quiet.prompt));
    const noBody: IdentityCard = { version: 1, identity: { face: { eyes: 'green' } } };
    const noBodyPrompt = buildIdentityPrompt(noBody, FIXTURE_SCENE).prompt;
    expect(identityLine(noBodyPrompt)).toBe('Person: eyes: green.');
    expect(noBodyPrompt).not.toContain('athletic');
  });

  it('leaves out identity leaves the card does not hold', () => {
    const card: IdentityCard = { version: 1, identity: { body: { height: 'short' }, face: { hair: { color: 'black' } } } };
    const line = buildIdentityPrompt(card, FIXTURE_SCENE).prompt.split('\n')[1];
    expect(line).toBe('Person: hair color: black; height: short.');
  });

  it('lets the scene outfit replace the default outfit completely', () => {
    const scene: Scene = { lighting: 'studio', framing: 'full_body', outfit: { one_piece: 'linen dress' } };
    const prompt = buildIdentityPrompt(FIXTURE_CARD, scene).prompt;
    expect(prompt).toContain('Outfit: one-piece: linen dress.');
    expect(prompt).not.toContain('sage-green');
    expect(prompt).not.toContain('jeans');
  });

  it('falls back to the default outfit, then to the reference outfit', () => {
    const scene: Scene = { lighting: 'studio', framing: 'full_body' };
    expect(buildIdentityPrompt(FIXTURE_CARD, scene).prompt).toContain('Outfit: top: sage-green t-shirt; bottom: jeans.');
    const noDefaults: IdentityCard = { version: 1, identity: { body: { height: 'tall' } } };
    expect(buildIdentityPrompt(noDefaults, scene).prompt).toContain('Outfit: keep the outfit from the reference photo.');
  });

  it('omits the pose and setting lines when the scene has none', () => {
    const prompt = buildIdentityPrompt(FIXTURE_CARD, { lighting: 'overcast', framing: 'head_and_shoulders' }).prompt;
    expect(prompt).not.toContain('Pose:');
    expect(prompt).not.toContain('Setting:');
    expect(prompt).toContain('Lighting: overcast.');
    expect(prompt).toContain('Framing: head-and-shoulders shot.');
  });

  it('always ends with the closing line and starts with the reference line', () => {
    for (const scene of [FIXTURE_SCENE, { lighting: 'night_city', framing: 'close_up' } satisfies Scene]) {
      const lines = buildIdentityPrompt(FIXTURE_CARD, scene).prompt.split('\n');
      expect(lines[0]).toBe("Edit the reference photo. Keep the person's face and body exactly as in the reference photo.");
      expect(lines[lines.length - 1]).toBe('Do not change the face, hair, eyes, skin, body build or height.');
    }
  });
});

describe('buildIdentityPrompt suggestedDescription', () => {
  it('is built from outfit, setting, lighting and framing words', () => {
    expect(buildIdentityPrompt(FIXTURE_CARD, FIXTURE_SCENE).suggestedDescription).toBe(
      'navy blazer, grey trousers, running shoes, city street at golden hour, golden hour lighting, waist up',
    );
  });

  it('never contains an identity leaf or a pose', () => {
    const { suggestedDescription } = buildIdentityPrompt(FIXTURE_CARD, FIXTURE_SCENE);
    for (const leaf of IDENTITY_LEAVES) expect(suggestedDescription).not.toContain(leaf);
    expect(suggestedDescription).not.toContain('facing camera');
  });

  it('uses the default outfit when the scene has none', () => {
    const { suggestedDescription } = buildIdentityPrompt(FIXTURE_CARD, { lighting: 'studio', framing: 'full_body' });
    expect(suggestedDescription).toBe('sage-green t-shirt, jeans, studio lighting, full body');
  });

  it('stays within the description limit even for the longest scene', () => {
    const long = 'x'.repeat(80);
    const scene: Scene = {
      lighting: 'warm_indoor',
      framing: 'head_and_shoulders',
      setting: long,
      outfit: { top: long, bottom: long, outerwear: long, footwear: long, accessories: long },
    };
    const { suggestedDescription } = buildIdentityPrompt(FIXTURE_CARD, scene);
    expect(suggestedDescription.length).toBeLessThanOrEqual(500);
    expect(suggestedDescription.length).toBeLessThanOrEqual(500);
    expect(suggestedDescription.endsWith(',')).toBe(false);
    expect(suggestedDescription.endsWith(' ')).toBe(false);
  });
});
