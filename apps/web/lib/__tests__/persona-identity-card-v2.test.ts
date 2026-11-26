import { describe, expect, it } from 'vitest';
import {
  CARD_STYLES,
  IDENTITY_CARD_ACCEPTED_VERSIONS,
  IDENTITY_CARD_MAX_BYTES,
  IDENTITY_CARD_WRITE_VERSION,
  IdentityCardSchema,
  parseIdentityCardJson,
  parseIdentityCardValue,
} from '@/lib/contracts/persona-identity-card';
import { identityCardErrorKey } from '@/lib/persona-identity-card-form';
import { FIXTURE_CARD, FIXTURE_CARD_V2 } from '@/test/identity-card-fixtures';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function fullCard(text: string): Record<string, unknown> {
  return {
    version: 2,
    identity: {
      face: {
        shape: text, eyes: text, eye_color: text, eyebrows: text, nose: text, lips: text, teeth: text, smile: text,
        skin: text, jawline: text, cheekbones: text, chin: text, forehead: text, ears: text,
        hair: { color: text, style: text, length: text, texture: text, parting: text },
        facial_hair: text, marks: text, tattoos: text,
      },
      body: {
        build: text, height: text, shoulders: text, arms: text, hands: text, waist: text, hips: text, legs: text,
        posture: text, proportions: text,
      },
    },
    defaults: {
      style: 'business',
      outfit: { top: text, bottom: text, outerwear: text, footwear: text, accessories: text },
    },
  };
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

describe('identity card v2', () => {
  it('accepts a v2 card with the new face, hair and body leaves', () => {
    expect(IdentityCardSchema.safeParse(FIXTURE_CARD_V2).success).toBe(true);
  });

  it('writes version 2 and accepts versions 1 and 2', () => {
    expect(IDENTITY_CARD_WRITE_VERSION).toBe(2);
    expect(IDENTITY_CARD_ACCEPTED_VERSIONS).toContain(IDENTITY_CARD_WRITE_VERSION);
    for (const version of IDENTITY_CARD_ACCEPTED_VERSIONS) {
      const card = version === 1 ? FIXTURE_CARD : FIXTURE_CARD_V2;
      expect(IdentityCardSchema.safeParse(card).success).toBe(true);
    }
  });

  it('accepts defaults that name only a style', () => {
    const card = { version: 2, identity: { face: { eyes: 'green' } }, defaults: { style: 'business' } };
    expect(parseIdentityCardValue(card).ok).toBe(true);
  });

  it('accepts defaults that name only an outfit', () => {
    const card = { version: 2, identity: { face: { eyes: 'green' } }, defaults: { outfit: { top: 'shirt' } } };
    expect(parseIdentityCardValue(card).ok).toBe(true);
  });

  it('accepts a card without defaults', () => {
    expect(parseIdentityCardValue({ version: 2, identity: { body: { posture: 'upright' } } }).ok).toBe(true);
  });

  it('rejects empty defaults with the style-or-outfit message', () => {
    const result = parseIdentityCardValue({ version: 2, identity: { face: { eyes: 'green' } }, defaults: {} });
    expect(result).toEqual({ ok: false, error: 'identityCard.defaults: must name a style or an outfit' });
  });

  it('rejects an empty outfit key even when a style is present', () => {
    const card = { version: 2, identity: { face: { eyes: 'green' } }, defaults: { style: 'business', outfit: {} } };
    const result = parseIdentityCardValue(card);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('must name at least one clothing slot');
  });

  it.each(CARD_STYLES)('accepts the %s style', (style) => {
    expect(IdentityCardSchema.safeParse({ ...clone(FIXTURE_CARD_V2), defaults: { style } }).success).toBe(true);
  });

  it.each(['Business', 'swimwear', 'sexy', '', 7])('rejects the free-text style %j', (style) => {
    expect(IdentityCardSchema.safeParse({ ...clone(FIXTURE_CARD_V2), defaults: { style } }).success).toBe(false);
  });

  it('still rejects a one-piece combined with a top inside a v2 outfit', () => {
    const card = { ...clone(FIXTURE_CARD_V2), defaults: { style: 'casual', outfit: { one_piece: 'dress', top: 'shirt' } } };
    const result = parseIdentityCardValue(card);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(identityCardErrorKey(result.error)).toBe('identityCard.errOnePiece');
  });

  it('keeps v1 cards from carrying v2 leaves or a style', () => {
    expect(IdentityCardSchema.safeParse({ version: 1, identity: { face: { eye_color: 'hazel' } } }).success).toBe(false);
    expect(IdentityCardSchema.safeParse({ version: 1, identity: { body: { posture: 'upright' } } }).success).toBe(false);
    expect(IdentityCardSchema.safeParse({ version: 1, identity: { face: { hair: { parting: 'left' } } } }).success).toBe(false);
    expect(IdentityCardSchema.safeParse({ ...clone(FIXTURE_CARD), defaults: { style: 'business' } }).success).toBe(false);
  });

  it('rejects an unknown key inside the v2 face, hair, body and defaults', () => {
    const paths: string[][] = [['identity', 'face'], ['identity', 'face', 'hair'], ['identity', 'body'], ['defaults']];
    for (const path of paths) {
      const card = clone(FIXTURE_CARD_V2) as Record<string, unknown>;
      let cursor = card;
      for (const key of path) cursor = cursor[key] as Record<string, unknown>;
      cursor.extra = 'x';
      expect(IdentityCardSchema.safeParse(card).success, path.join('.')).toBe(false);
    }
  });
});

describe('identity card byte budget', () => {
  it('fits a v2 card with every leaf at 80 ASCII characters inside the cap', () => {
    const card = fullCard('a'.repeat(80));
    expect(byteLength(card)).toBeLessThanOrEqual(IDENTITY_CARD_MAX_BYTES);
    expect(parseIdentityCardValue(card).ok).toBe(true);
    expect(parseIdentityCardJson(JSON.stringify(card)).ok).toBe(true);
  });

  it('rejects an accented card that passes every 80-character check with the size message', () => {
    const card = fullCard('é'.repeat(80));
    expect(byteLength(card)).toBeGreaterThan(IDENTITY_CARD_MAX_BYTES);
    const result = parseIdentityCardValue(card);
    expect(result).toEqual({
      ok: false,
      error: `identityCard: too large to store (at most ${IDENTITY_CARD_MAX_BYTES} bytes; accented or non-Latin text uses more bytes)`,
    });
    if (!result.ok) expect(identityCardErrorKey(result.error)).toBe('identityCard.errTooLarge');
  });

  it('rejects the same accented card sent as JSON text', () => {
    const result = parseIdentityCardJson(JSON.stringify(fullCard('é'.repeat(80))));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(identityCardErrorKey(result.error)).toBe('identityCard.errTooLarge');
  });

  it('rejects an over-byte card that is not a valid shape with the shape error first', () => {
    const card = fullCard('é'.repeat(80));
    (card.identity as Record<string, unknown>).extra = 'x';
    const result = parseIdentityCardValue(card);
    expect(result).toEqual({ ok: false, error: 'identityCard.identity: unknown field' });
  });
});
