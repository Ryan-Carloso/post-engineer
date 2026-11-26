import { describe, expect, it } from 'vitest';
import {
  CARD_STYLES,
  IDENTITY_CARD_ACCEPTED_VERSIONS,
  IDENTITY_CARD_MAX_BYTES,
  IDENTITY_TEXT_MAX_LENGTH,
  IdentityCardSchema,
  IdentityCardV1Schema,
  RenderIdentityPromptResponseSchema,
  SCENE_MAX_BYTES,
  SceneSchema,
  parseIdentityCardJson,
  parseIdentityCardValue,
  parseSceneJson,
  parseSceneValue,
} from '@/lib/contracts/persona-identity-card';
import { FIXTURE_CARD, FIXTURE_SCENE } from '@/test/identity-card-fixtures';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withPath(card: unknown, path: string[], value: unknown): unknown {
  const copy = clone(card) as Record<string, unknown>;
  let cursor = copy;
  for (const key of path.slice(0, -1)) {
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[path[path.length - 1]] = value;
  return copy;
}

describe('IdentityCardSchema', () => {
  it('accepts a full v1 card', () => {
    expect(IdentityCardSchema.safeParse(FIXTURE_CARD).success).toBe(true);
  });

  it('accepts a card with a single identity leaf and no defaults', () => {
    expect(IdentityCardSchema.safeParse({ version: 1, identity: { body: { height: 'tall' } } }).success).toBe(true);
  });

  it('rejects a card with no identity leaf at all', () => {
    expect(IdentityCardSchema.safeParse({ version: 1, identity: {} }).success).toBe(false);
    expect(IdentityCardSchema.safeParse({ version: 1, identity: { face: {}, body: {} } }).success).toBe(false);
  });

  it.each([
    ['root', [] as string[]],
    ['identity', ['identity']],
    ['face', ['identity', 'face']],
    ['hair', ['identity', 'face', 'hair']],
    ['body', ['identity', 'body']],
    ['defaults', ['defaults']],
    ['outfit', ['defaults', 'outfit']],
  ])('rejects an unknown key at the %s level', (_name, path) => {
    const mutated = path.length === 0
      ? { ...clone(FIXTURE_CARD), extra: 'x' }
      : withPath(FIXTURE_CARD, [...path, 'extra'], 'x');
    expect(IdentityCardSchema.safeParse(mutated).success).toBe(false);
  });

  it('keeps the v1 schema pinned to version 1, whatever versions the server accepts', () => {
    expect(IdentityCardV1Schema.safeParse(FIXTURE_CARD).success).toBe(true);
    expect(IdentityCardV1Schema.safeParse({ ...clone(FIXTURE_CARD), version: 2 }).success).toBe(false);
  });

  it('accepts exactly versions 1 and 2 as response card versions', () => {
    expect(IDENTITY_CARD_ACCEPTED_VERSIONS).toEqual([1, 2]);
    const base = { success: true, prompt: 'p', suggestedDescription: 'd' };
    for (const cardVersion of IDENTITY_CARD_ACCEPTED_VERSIONS) {
      expect(RenderIdentityPromptResponseSchema.safeParse({ ...base, cardVersion }).success).toBe(true);
    }
    for (const cardVersion of [0, 3, '1', null]) {
      expect(RenderIdentityPromptResponseSchema.safeParse({ ...base, cardVersion }).success).toBe(false);
    }
  });

  it.each([3, '1', 0, null, undefined])('rejects version %s', (version) => {
    expect(IdentityCardSchema.safeParse({ ...clone(FIXTURE_CARD), version }).success).toBe(false);
  });

  it('rejects empty, whitespace-only, over-length and multi-line leaves', () => {
    for (const value of ['', '   ', 'x'.repeat(IDENTITY_TEXT_MAX_LENGTH + 1), 'blue\ngrey', 'blue\rgrey', 'blue\u0000grey', 'a b']) {
      expect(IdentityCardSchema.safeParse(withPath(FIXTURE_CARD, ['identity', 'face', 'eyes'], value)).success).toBe(false);
    }
  });

  it('accepts a leaf of exactly 80 characters and trims surrounding whitespace', () => {
    const exact = 'y'.repeat(IDENTITY_TEXT_MAX_LENGTH);
    expect(IdentityCardSchema.safeParse(withPath(FIXTURE_CARD, ['identity', 'face', 'eyes'], exact)).success).toBe(true);
    const parsed = IdentityCardSchema.parse(withPath(FIXTURE_CARD, ['identity', 'face', 'eyes'], `  ${exact}  `));
    expect(parsed.identity.face?.eyes).toBe(exact);
  });

  it('rejects one_piece together with top or bottom, and accepts it alone', () => {
    expect(IdentityCardSchema.safeParse(withPath(FIXTURE_CARD, ['defaults', 'outfit', 'one_piece'], 'linen dress')).success).toBe(false);
    expect(IdentityCardSchema.safeParse(withPath(FIXTURE_CARD, ['defaults', 'outfit'], { one_piece: 'linen dress', footwear: 'sandals' })).success).toBe(true);
    expect(IdentityCardSchema.safeParse(withPath(FIXTURE_CARD, ['defaults', 'outfit'], { one_piece: 'linen dress', top: 'shirt' })).success).toBe(false);
  });

  it('rejects an empty outfit', () => {
    expect(IdentityCardSchema.safeParse(withPath(FIXTURE_CARD, ['defaults', 'outfit'], {})).success).toBe(false);
  });

  it('rejects an empty defaults object', () => {
    expect(parseIdentityCardValue({ ...clone(FIXTURE_CARD), defaults: {} })).toEqual({
      ok: false,
      error: 'identityCard.defaults: must name an outfit',
    });
  });

  it('rejects outfit slots that carry identity words or sexualised clothing', () => {
    expect(IdentityCardSchema.safeParse(withPath(FIXTURE_CARD, ['defaults', 'outfit', 'top'], 'tank top showing a muscular build')).success).toBe(false);
    expect(IdentityCardSchema.safeParse(withPath(FIXTURE_CARD, ['defaults', 'outfit', 'top'], 'lingerie set')).success).toBe(false);
  });

  it.each([
    ['top', 'skinny jeans'],
    ['bottom', 'skintight leggings'],
    ['accessories', 'eyeglasses'],
    ['accessories', 'eyewear'],
    ['top', 'eyelet blouse'],
  ])('accepts clothing words that share a stem with an identity word in %s (%s)', (slot, value) => {
    expect(IdentityCardSchema.safeParse(withPath(FIXTURE_CARD, ['defaults', 'outfit', slot], value)).success).toBe(true);
  });

  it.each([
    ['top', 'bare skin'],
    ['top', 'blue eyes'],
    ['top', 'bald head'],
    ['top', 'long hair'],
  ])('still rejects real identity words in %s (%s)', (slot, value) => {
    expect(IdentityCardSchema.safeParse(withPath(FIXTURE_CARD, ['defaults', 'outfit', slot], value)).success).toBe(false);
  });

  it.each([
    ['top', 'transparent glass-bead top'],
    ['top', 'transparent glass-effect blouse'],
    ['top', 'sheer curtains-style dress'],
  ])('rejects see-through words hidden behind a hyphen in %s (%s)', (slot, value) => {
    expect(IdentityCardSchema.safeParse(withPath(FIXTURE_CARD, ['defaults', 'outfit', slot], value)).success).toBe(false);
  });
});

describe('SceneSchema', () => {
  it('accepts a full scene and a scene with only the required enums', () => {
    expect(SceneSchema.safeParse(FIXTURE_SCENE).success).toBe(true);
    expect(SceneSchema.safeParse({ lighting: 'studio', framing: 'close_up' }).success).toBe(true);
  });

  it.each(['identity', 'face', 'body', 'version', 'defaults'])('rejects the identity-side key %s', (key) => {
    expect(SceneSchema.safeParse({ ...clone(FIXTURE_SCENE), [key]: { eyes: 'green' } }).success).toBe(false);
  });

  it('accepts every card style as the scene style and rejects anything else', () => {
    for (const style of CARD_STYLES) {
      expect(SceneSchema.safeParse({ ...FIXTURE_SCENE, style }).success).toBe(true);
    }
    expect(SceneSchema.safeParse({ ...FIXTURE_SCENE, style: 'bikini' }).success).toBe(false);
    expect(SceneSchema.safeParse({ ...FIXTURE_SCENE, style: 'Business' }).success).toBe(false);
    expect(SceneSchema.safeParse({ ...FIXTURE_SCENE, style: '' }).success).toBe(false);
    const result = parseSceneValue({ ...FIXTURE_SCENE, style: 'bikini' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('scene.style: not an allowed value');
  });

  it('rejects a full identity card passed as the scene', () => {
    expect(SceneSchema.safeParse(FIXTURE_CARD).success).toBe(false);
  });

  it('enforces the lighting, framing and aspect enums', () => {
    expect(SceneSchema.safeParse({ ...FIXTURE_SCENE, lighting: 'soft warm' }).success).toBe(false);
    expect(SceneSchema.safeParse({ ...FIXTURE_SCENE, framing: '9:16 full body' }).success).toBe(false);
    expect(SceneSchema.safeParse({ ...FIXTURE_SCENE, aspect: '3:2' }).success).toBe(false);
    expect(SceneSchema.safeParse({ lighting: 'studio' }).success).toBe(false);
    expect(SceneSchema.safeParse({ framing: 'full_body' }).success).toBe(false);
  });

  it('rejects an unknown key inside the scene outfit and an over-long pose', () => {
    expect(SceneSchema.safeParse({ ...FIXTURE_SCENE, outfit: { top: 'shirt', hat: 'cap' } }).success).toBe(false);
    expect(SceneSchema.safeParse({ ...FIXTURE_SCENE, pose: 'p'.repeat(81) }).success).toBe(false);
    expect(SceneSchema.safeParse({ ...FIXTURE_SCENE, setting: 'p'.repeat(80) }).success).toBe(true);
  });

  it('accepts "facing camera" because the denylist matches whole words', () => {
    expect(SceneSchema.safeParse({ ...FIXTURE_SCENE, pose: 'facing camera, building behind' }).success).toBe(true);
  });

  it.each([
    ['pose', 'standing, red hair'],
    ['setting', 'gym, with a full beard'],
    ['pose', 'arms crossed, blue Eyes'],
  ])('rejects identity words in %s (%s) and names the field', (field, text) => {
    const result = parseSceneValue({ ...FIXTURE_SCENE, [field]: text });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.startsWith(`scene.${field}:`)).toBe(true);
      expect(result.error).not.toContain(text);
    }
  });

  it.each([
    ['pose', 'blonde woman smiling'],
    ['pose', 'blue-eyed redhead'],
    ['pose', 'long-haired, bald'],
    ['pose', 'tank top that shows abs'],
    ['setting', 'cabelo loiro'],
  ])('rejects identity words that evade whole-word matching in %s (%s)', (field, text) => {
    const result = parseSceneValue({ ...FIXTURE_SCENE, [field]: text });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.startsWith(`scene.${field}:`)).toBe(true);
      expect(result.error).not.toContain(text);
    }
  });

  it.each([
    ['pose', 'skinny woman'],
    ['pose', 'skinny jeans'],
  ])('rejects "skinny" in %s (%s) as a body-shape word', (field, text) => {
    const result = parseSceneValue({ ...FIXTURE_SCENE, [field]: text });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.startsWith(`scene.${field}:`)).toBe(true);
      expect(result.error).not.toContain(text);
    }
  });

  it('accepts "body of water" as a setting', () => {
    expect(SceneSchema.safeParse({ ...FIXTURE_SCENE, setting: 'body of water' }).success).toBe(true);
  });

  it.each([
    ['setting', 'sheer curtains'],
    ['setting', 'transparent glass wall'],
    ['setting', 'sipping ginger tea'],
    ['setting', 'bald eagle soaring'],
  ])('accepts harmless scene text that shares words with the denylist in %s (%s)', (field, text) => {
    expect(SceneSchema.safeParse({ ...FIXTURE_SCENE, [field]: text }).success).toBe(true);
  });

  it.each([
    ['pose', 'sheer dress'],
    ['pose', 'transparent top'],
    ['pose', 'ginger hair'],
    ['pose', 'bald man'],
  ])('still rejects real identity and sexualised words in %s (%s)', (field, text) => {
    const result = parseSceneValue({ ...FIXTURE_SCENE, [field]: text });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.startsWith(`scene.${field}:`)).toBe(true);
      expect(result.error).not.toContain(text);
    }
  });

  it.each([
    ['pose', 'topless on the bed'],
    ['pose', 'naked'],
    ['setting', 'nude beach'],
    ['pose', 'see-through dress'],
  ])('rejects sexualised content in %s (%s) and names the field', (field, text) => {
    const result = parseSceneValue({ ...FIXTURE_SCENE, [field]: text });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(`scene.${field}: nude or sexualised content is not allowed`);
      expect(result.error).not.toContain(text);
    }
  });

  it('rejects identity words in scene outfit slots', () => {
    const result = parseSceneValue({ ...FIXTURE_SCENE, outfit: { top: 'tank top showing a muscular build' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.startsWith('scene.outfit.top:')).toBe(true);
  });
});

describe('parseIdentityCardJson and parseSceneJson', () => {
  it('parses a valid card and a valid scene from JSON text', () => {
    const card = parseIdentityCardJson(JSON.stringify(FIXTURE_CARD));
    expect(card).toEqual({ ok: true, value: FIXTURE_CARD });
    const scene = parseSceneJson(JSON.stringify(FIXTURE_SCENE));
    expect(scene).toEqual({ ok: true, value: FIXTURE_SCENE });
  });

  it('rejects invalid JSON without echoing it', () => {
    const result = parseIdentityCardJson('{"version": 1, "secret-eyes"');
    expect(result).toEqual({ ok: false, error: 'identityCard: not valid JSON' });
  });

  it('rejects an over-size card before parsing it', () => {
    const big = `{"version":1,"identity":{"face":{"eyes":"${'a'.repeat(IDENTITY_CARD_MAX_BYTES)}"}}}`;
    expect(parseIdentityCardJson(big)).toEqual({ ok: false, error: `identityCard: at most ${IDENTITY_CARD_MAX_BYTES} bytes` });
  });

  it('counts bytes, not characters', () => {
    const multibyte = `"${'é'.repeat(SCENE_MAX_BYTES / 2)}"`;
    expect(parseSceneJson(multibyte)).toEqual({ ok: false, error: `scene: at most ${SCENE_MAX_BYTES} bytes` });
  });

  it('builds errors from the path only', () => {
    const secret = 'secret-eyes-value'.padEnd(81, 'x');
    const result = parseIdentityCardJson(JSON.stringify(withPath(FIXTURE_CARD, ['identity', 'face', 'eyes'], secret)));
    expect(result).toEqual({ ok: false, error: 'identityCard.identity.face.eyes: at most 80 characters' });
  });

  it('names unknown keys and unsupported versions without echoing values', () => {
    const unknownKey = parseIdentityCardJson(JSON.stringify({ ...clone(FIXTURE_CARD), eyes: 'green-value' }));
    expect(unknownKey.ok).toBe(false);
    if (!unknownKey.ok) {
      expect(unknownKey.error).toBe('identityCard: unknown field');
      expect(unknownKey.error).not.toContain('green-value');
    }
    const badVersion = parseIdentityCardJson(JSON.stringify({ ...clone(FIXTURE_CARD), version: 3 }));
    expect(badVersion).toEqual({ ok: false, error: 'identityCard.version: unsupported version' });
  });

  it('reports a non-object card', () => {
    expect(parseIdentityCardJson('"text"').ok).toBe(false);
    expect(parseIdentityCardJson('[]').ok).toBe(false);
  });
});
