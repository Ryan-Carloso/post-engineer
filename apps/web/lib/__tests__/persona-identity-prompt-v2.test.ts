import { describe, expect, it } from 'vitest';
import {
  CARD_STYLES,
  STYLE_PROMPT,
  parseSceneValue,
  type IdentityCard,
  type Scene,
} from '@/lib/contracts/persona-identity-card';
import { buildIdentityPrompt } from '../persona-identity-prompt';
import { FIXTURE_CARD, FIXTURE_CARD_V2 } from '@/test/identity-card-fixtures';

const BASE_SCENE: Scene = { lighting: 'golden_hour', framing: 'waist_up' };

const FULL_CARD: IdentityCard = {
  version: 2,
  identity: {
    face: {
      shape: 'a1',
      eyes: 'a2',
      eye_color: 'a3',
      eyebrows: 'a4',
      nose: 'a5',
      lips: 'a6',
      teeth: 'a7',
      smile: 'a8',
      skin: 'a9',
      jawline: 'b1',
      cheekbones: 'b2',
      chin: 'b3',
      forehead: 'b4',
      ears: 'b5',
      hair: { color: 'b6', style: 'b7', length: 'b8', texture: 'b9', parting: 'c1' },
      facial_hair: 'c2',
      marks: 'c3',
      tattoos: 'c4',
    },
    body: {
      build: 'd1',
      height: 'd2',
      shoulders: 'd3',
      arms: 'd4',
      hands: 'd5',
      waist: 'd6',
      hips: 'd7',
      legs: 'd8',
      posture: 'd9',
      proportions: 'e1',
    },
  },
  defaults: { style: 'casual' },
};

function line(prompt: string, prefix: string): string | undefined {
  return prompt.split('\n').find((candidate) => candidate.startsWith(prefix));
}

describe('buildIdentityPrompt for a v2 card', () => {
  it('renders every identity leaf in the fixed order and the v2 closing line', () => {
    const { prompt } = buildIdentityPrompt(FULL_CARD, BASE_SCENE);
    expect(line(prompt, 'Person:')).toBe(
      'Person: face shape: a1; eyes: a2; eye color: a3; eyebrows: a4; nose: a5; lips: a6; teeth: a7; smile: a8; skin: a9; jawline: b1; cheekbones: b2; chin: b3; forehead: b4; ears: b5; hair color: b6; hair style: b7; hair length: b8; hair texture: b9; hair parting: c1; facial hair: c2; marks: c3; tattoos: c4; body build: d1; height: d2; shoulders: d3; arms: d4; hands: d5; waist: d6; hips: d7; legs: d8; posture: d9; proportions: e1.',
    );
    expect(prompt.endsWith(
      'Do not change the face, hair, eyes, skin, body build, height, jawline, resting posture or proportions.',
    )).toBe(true);
  });

  it('keeps posture and smile on the Person line when a pose is set', () => {
    const { prompt } = buildIdentityPrompt(FULL_CARD, { ...BASE_SCENE, pose: 'arms crossed' });
    expect(line(prompt, 'Person:')).toContain('smile: a8');
    expect(line(prompt, 'Person:')).toContain('posture: d9');
    expect(line(prompt, 'Pose:')).toBe('Pose: arms crossed.');
    expect(prompt.endsWith(
      'Do not change the face, hair, eyes, skin, body build, height, jawline or proportions.',
    )).toBe(true);
    expect(prompt).not.toContain('resting posture');
  });

  it('drops the resting posture clause from the closing line for a stance-changing pose', () => {
    const { prompt } = buildIdentityPrompt(FULL_CARD, { ...BASE_SCENE, pose: 'sitting' });
    expect(line(prompt, 'Person:')).toContain('smile: a8');
    expect(line(prompt, 'Person:')).toContain('posture: d9');
    expect(line(prompt, 'Pose:')).toBe('Pose: sitting.');
    expect(prompt.endsWith(
      'Do not change the face, hair, eyes, skin, body build, height, jawline or proportions.',
    )).toBe(true);
    expect(prompt).not.toContain('resting posture');
  });

  it('renders the style line with its safe description and a style-only scene as the clothing', () => {
    const { prompt } = buildIdentityPrompt(FIXTURE_CARD_V2, { ...BASE_SCENE, style: 'streetwear' });
    expect(prompt).toMatchInlineSnapshot(`
      "Edit the reference photo. Keep the person's face and body exactly as in the reference photo.
      Person: face shape: oval; eyes: almond, wide-set; eye color: hazel; smile: closed-lip, slight asymmetry; jawline: soft; hair color: dark brown; hair style: wavy; hair length: shoulder length; hair texture: fine; hair parting: left side; body build: athletic, toned; height: tall; posture: upright; proportions: long legs, short torso.
      Style: streetwear (urban, casual street clothes).
      Lighting: golden hour.
      Framing: waist-up shot.
      Do not change the face, hair, eyes, skin, body build, height, jawline, resting posture or proportions."
    `);
  });

  it('keeps the Person line and the closing line identical across styles', () => {
    const lines = (style: Scene['style']): [string | undefined, string | undefined] => {
      const { prompt } = buildIdentityPrompt(FIXTURE_CARD_V2, { ...BASE_SCENE, style });
      return [line(prompt, 'Person:'), prompt.split('\n').at(-1)];
    };
    const [personA, closingA] = lines('business');
    const [personB, closingB] = lines('sporty');
    expect(personA).toBeDefined();
    expect(personB).toBe(personA);
    expect(closingB).toBe(closingA);
    expect(buildIdentityPrompt(FIXTURE_CARD_V2, { ...BASE_SCENE, style: 'business' }).prompt).not.toBe(
      buildIdentityPrompt(FIXTURE_CARD_V2, { ...BASE_SCENE, style: 'sporty' }).prompt,
    );
  });

  it('drops the default outfit and the keep-outfit line for a scene that names only a style', () => {
    const { prompt } = buildIdentityPrompt(FIXTURE_CARD_V2, { ...BASE_SCENE, style: 'sporty' });
    expect(line(prompt, 'Style:')).toBe('Style: sporty (athletic wear).');
    expect(line(prompt, 'Outfit:')).toBeUndefined();
    expect(prompt).not.toContain('white shirt');
    expect(prompt).not.toContain('keep the outfit');
  });

  it('uses the default style with the default outfit and fills the unnamed slots with the style', () => {
    const { prompt } = buildIdentityPrompt(FIXTURE_CARD_V2, BASE_SCENE);
    expect(line(prompt, 'Style:')).toBe('Style: business (tailored suit, formal office wear).');
    expect(line(prompt, 'Outfit:')).toBe(
      'Outfit: top: white shirt; footwear: black loafers; other garments in business style.',
    );
    expect(prompt).not.toContain('keep the outfit');
  });

  it('lets a scene outfit stand alone when the scene also names a style', () => {
    const scene: Scene = { ...BASE_SCENE, style: 'streetwear', outfit: { outerwear: 'denim jacket' } };
    const { prompt } = buildIdentityPrompt(FIXTURE_CARD_V2, scene);
    expect(line(prompt, 'Outfit:')).toBe('Outfit: outerwear: denim jacket; other garments in streetwear style.');
    expect(prompt).not.toContain('white shirt');
    expect(prompt).not.toContain('loafers');
  });

  it('adds no filler when the outfit names every garment', () => {
    const scene: Scene = {
      ...BASE_SCENE,
      style: 'casual',
      outfit: { top: 't', bottom: 'b', outerwear: 'o', footwear: 'f', accessories: 'a' },
    };
    expect(line(buildIdentityPrompt(FIXTURE_CARD_V2, scene).prompt, 'Outfit:')).toBe(
      'Outfit: top: t; bottom: b; outerwear: o; footwear: f; accessories: a.',
    );
    const onePiece: Scene = { ...scene, outfit: { one_piece: 'p', outerwear: 'o', footwear: 'f', accessories: 'a' } };
    expect(line(buildIdentityPrompt(FIXTURE_CARD_V2, onePiece).prompt, 'Outfit:')).not.toContain('other garments');
    const missingAccessories: Scene = { ...scene, outfit: { top: 't', bottom: 'b', outerwear: 'o', footwear: 'f' } };
    expect(line(buildIdentityPrompt(FIXTURE_CARD_V2, missingAccessories).prompt, 'Outfit:')).toContain(
      'other garments in casual style',
    );
  });

  it('merges a scene outfit over the default outfit slot by slot when the scene has no style', () => {
    const card: IdentityCard = { ...FIXTURE_CARD_V2, defaults: { outfit: { top: 'white shirt', footwear: 'loafers' } } };
    const { prompt } = buildIdentityPrompt(card, { ...BASE_SCENE, outfit: { top: 'black tee', outerwear: 'parka' } });
    expect(line(prompt, 'Outfit:')).toBe('Outfit: top: black tee; outerwear: parka; footwear: loafers.');
    expect(line(prompt, 'Style:')).toBeUndefined();
  });

  it('keeps the default style line and its filler when a scene outfit merges over a default style and outfit', () => {
    const { prompt } = buildIdentityPrompt(FIXTURE_CARD_V2, { ...BASE_SCENE, outfit: { top: 'black tee' } });
    expect(line(prompt, 'Style:')).toBe('Style: business (tailored suit, formal office wear).');
    expect(line(prompt, 'Outfit:')).toBe(
      'Outfit: top: black tee; footwear: black loafers; other garments in business style.',
    );
  });

  it('removes the default top and bottom when the scene brings a one-piece', () => {
    const card: IdentityCard = {
      ...FIXTURE_CARD_V2,
      defaults: { outfit: { top: 'shirt', bottom: 'jeans', footwear: 'boots' } },
    };
    const { prompt } = buildIdentityPrompt(card, { ...BASE_SCENE, outfit: { one_piece: 'linen dress' } });
    expect(line(prompt, 'Outfit:')).toBe('Outfit: one-piece: linen dress; footwear: boots.');
  });

  it('removes the default one-piece when the scene brings a top or a bottom', () => {
    const card: IdentityCard = { ...FIXTURE_CARD_V2, defaults: { outfit: { one_piece: 'dress', footwear: 'flats' } } };
    expect(line(buildIdentityPrompt(card, { ...BASE_SCENE, outfit: { top: 'blouse' } }).prompt, 'Outfit:')).toBe(
      'Outfit: top: blouse; footwear: flats.',
    );
    expect(line(buildIdentityPrompt(card, { ...BASE_SCENE, outfit: { bottom: 'skirt' } }).prompt, 'Outfit:')).toBe(
      'Outfit: bottom: skirt; footwear: flats.',
    );
  });

  it('never merges to an outfit that mixes a one-piece with a top or bottom', () => {
    const defaults: Array<NonNullable<IdentityCard['defaults']>['outfit']> = [
      { one_piece: 'dress' },
      { top: 'shirt' },
      { bottom: 'jeans' },
      { top: 'shirt', bottom: 'jeans', footwear: 'boots' },
    ];
    const overrides: Array<NonNullable<Scene['outfit']>> = [
      { one_piece: 'jumpsuit' },
      { top: 'tee' },
      { bottom: 'shorts' },
      { outerwear: 'coat' },
    ];
    for (const outfit of defaults) {
      for (const override of overrides) {
        const card: IdentityCard = { ...FIXTURE_CARD_V2, defaults: { outfit } };
        const outfitLine = line(buildIdentityPrompt(card, { ...BASE_SCENE, outfit: override }).prompt, 'Outfit:') ?? '';
        const hasOnePiece = outfitLine.includes('one-piece:');
        const hasSplit = outfitLine.includes('top:') || outfitLine.includes('bottom:');
        expect(hasOnePiece && hasSplit).toBe(false);
      }
    }
  });

  it('still rejects a one-piece combined with a top inside the scene itself', () => {
    const result = parseSceneValue({ ...BASE_SCENE, outfit: { one_piece: 'dress', top: 'tee' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('cannot be combined with top or bottom');
  });

  it('keeps the keep-outfit line only when there is neither a style nor an outfit', () => {
    const bare: IdentityCard = { version: 2, identity: { body: { height: 'tall' } } };
    expect(buildIdentityPrompt(bare, BASE_SCENE).prompt).toContain('Outfit: keep the outfit from the reference photo.');
    const withStyle: IdentityCard = { ...bare, defaults: { style: 'cozy' } };
    const prompt = buildIdentityPrompt(withStyle, BASE_SCENE).prompt;
    expect(prompt).not.toContain('keep the outfit');
    expect(line(prompt, 'Style:')).toBe('Style: cozy (soft knits, warm layers).');
  });

  it.each(CARD_STYLES)('renders the label and safe description for the %s style', (style) => {
    const { label, description } = STYLE_PROMPT[style];
    expect(line(buildIdentityPrompt(FIXTURE_CARD_V2, { ...BASE_SCENE, style }).prompt, 'Style:')).toBe(
      `Style: ${label} (${description}).`,
    );
  });

  it('keeps the suggested description free of the style label and the Person line', () => {
    const { suggestedDescription } = buildIdentityPrompt(FIXTURE_CARD_V2, { ...BASE_SCENE, style: 'streetwear' });
    expect(suggestedDescription).toBe('golden hour lighting, waist up');
  });
});

describe('buildIdentityPrompt for a v1 card', () => {
  it('keeps the original closing line and Person leaves', () => {
    const { prompt } = buildIdentityPrompt(FIXTURE_CARD, BASE_SCENE);
    expect(prompt.split('\n').at(-1)).toBe('Do not change the face, hair, eyes, skin, body build or height.');
    expect(prompt).not.toContain('jawline');
    expect(prompt).not.toContain('Style:');
  });

  it('renders a scene style on a v1 card and drops the default outfit', () => {
    const { prompt } = buildIdentityPrompt(FIXTURE_CARD, { ...BASE_SCENE, style: 'elegant' });
    expect(line(prompt, 'Style:')).toBe('Style: elegant (refined, understated, timeless).');
    expect(line(prompt, 'Outfit:')).toBeUndefined();
    expect(prompt.split('\n').at(-1)).toBe('Do not change the face, hair, eyes, skin, body build or height.');
  });
});
