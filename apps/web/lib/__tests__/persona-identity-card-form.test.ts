import { describe, expect, it } from 'vitest';
import {
  IDENTITY_CARD_FIELDS,
  IDENTITY_CARD_TEXT_FIELDS,
  cardToDraft,
  draftToCard,
  emptyIdentityCardDraft,
  identityCardErrorKey,
  identityCardFormValue,
  localizeIdentityCardResult,
  sameIdentityCardDraft,
  validateIdentityCardDraft,
} from '../persona-identity-card-form';
import { FIXTURE_CARD, FIXTURE_CARD_V2 } from '@/test/identity-card-fixtures';
import { CARD_STYLES, IdentityCardSchema, parseIdentityCardJson, parseIdentityCardValue, type IdentityCard, type ParsedCardInput } from '@/lib/contracts/persona-identity-card';

function draftWith(values: Partial<Record<(typeof IDENTITY_CARD_FIELDS)[number], string>>) {
  return { ...emptyIdentityCardDraft(), ...values };
}

describe('identity card draft', () => {
  it('lists every identity leaf, outfit slot and the style exactly once', () => {
    expect(new Set(IDENTITY_CARD_FIELDS).size).toBe(IDENTITY_CARD_FIELDS.length);
    expect(IDENTITY_CARD_TEXT_FIELDS).toHaveLength(38);
    expect(IDENTITY_CARD_FIELDS).toEqual([...IDENTITY_CARD_TEXT_FIELDS, 'style']);
  });

  it('round-trips a v2 card through the draft', () => {
    expect(draftToCard(cardToDraft(FIXTURE_CARD_V2))).toEqual(FIXTURE_CARD_V2);
  });

  it('reads a v1 card into the draft with no style and writes it back as v2 with the same content', () => {
    const draft = cardToDraft(FIXTURE_CARD);
    expect(draft.style).toBe('');
    expect(draftToCard(draft)).toEqual({ ...FIXTURE_CARD, version: 2 });
  });

  it('reads the style of a v2 card into the draft', () => {
    expect(cardToDraft(FIXTURE_CARD_V2).style).toBe('business');
  });

  it('keeps every style and leaf the contract accepts reachable from the draft', () => {
    for (const style of CARD_STYLES) {
      const card = draftToCard(draftWith({ 'face.eyes': 'green', style }));
      expect(IdentityCardSchema.safeParse(card).success).toBe(true);
      expect(card).toEqual({ version: 2, identity: { face: { eyes: 'green' } }, defaults: { style } });
    }
  });

  it('writes a style and an outfit side by side under the defaults', () => {
    expect(draftToCard(draftWith({ 'face.eyes': 'green', style: 'sporty', 'outfit.top': 'tee' }))).toEqual({
      version: 2,
      identity: { face: { eyes: 'green' } },
      defaults: { style: 'sporty', outfit: { top: 'tee' } },
    });
  });

  it('counts a style alone as a filled card so clearing every trait never reads as clearing the card', () => {
    const card = draftToCard(draftWith({ style: 'casual' }));
    expect(card).toEqual({ version: 2, identity: {}, defaults: { style: 'casual' } });
    expect(identityCardFormValue(draftWith({ style: 'casual' }), cardToDraft(FIXTURE_CARD))).not.toBe('null');
  });

  it('drops a stored style the contract does not know instead of showing an empty style', () => {
    const card = { ...FIXTURE_CARD_V2, defaults: { style: 'bikini' } } as unknown as IdentityCard;
    expect(cardToDraft(card).style).toBe('');
  });

  it('turns no card into a blank draft and a blank draft into no card', () => {
    expect(cardToDraft(null)).toEqual(emptyIdentityCardDraft());
    expect(draftToCard(emptyIdentityCardDraft())).toBeNull();
    expect(draftToCard(draftWith({ 'face.eyes': '   ' }))).toBeNull();
  });

  it('trims values and leaves blank fields out of the card', () => {
    expect(draftToCard(draftWith({ 'face.eyes': '  green ', 'body.height': 'tall' }))).toEqual({
      version: 2,
      identity: { face: { eyes: 'green' }, body: { height: 'tall' } },
    });
  });

  it('builds nested hair and default outfit from their flat fields', () => {
    expect(draftToCard(draftWith({ 'face.hair.color': 'black', 'outfit.top': 'shirt' }))).toEqual({
      version: 2,
      identity: { face: { hair: { color: 'black' } } },
      defaults: { outfit: { top: 'shirt' } },
    });
  });

  it('compares drafts by value', () => {
    expect(sameIdentityCardDraft(cardToDraft(FIXTURE_CARD), cardToDraft(FIXTURE_CARD))).toBe(true);
    expect(sameIdentityCardDraft(cardToDraft(FIXTURE_CARD), draftWith({}))).toBe(false);
    expect(sameIdentityCardDraft(draftWith({ 'face.eyes': 'a ' }), draftWith({ 'face.eyes': 'a' }))).toBe(true);
  });
});

describe('identityCardFormValue', () => {
  it('sends nothing when the draft is unchanged', () => {
    expect(identityCardFormValue(emptyIdentityCardDraft(), emptyIdentityCardDraft())).toBeNull();
    const loaded = cardToDraft(FIXTURE_CARD);
    expect(identityCardFormValue(loaded, loaded)).toBeNull();
  });

  it('sends the card JSON when the draft changed', () => {
    const value = identityCardFormValue(draftWith({ 'face.eyes': 'green' }), emptyIdentityCardDraft());
    expect(JSON.parse(value ?? 'null')).toEqual({ version: 2, identity: { face: { eyes: 'green' } } });
  });

  it('keeps a stored v1 card untouched until the user edits a field', () => {
    const stored: IdentityCard = FIXTURE_CARD;
    const loaded = cardToDraft(stored);
    expect(identityCardFormValue(cardToDraft(stored), loaded)).toBeNull();
    const edited = identityCardFormValue({ ...loaded, 'face.eyes': 'green' }, loaded);
    expect(JSON.parse(edited ?? 'null')).toMatchObject({ version: 2 });
  });

  it('sends the JSON literal null when a stored card was emptied', () => {
    expect(identityCardFormValue(emptyIdentityCardDraft(), cardToDraft(FIXTURE_CARD))).toBe('null');
  });
});

describe('validateIdentityCardDraft', () => {
  it('accepts a blank draft and a valid one', () => {
    expect(validateIdentityCardDraft(emptyIdentityCardDraft())).toEqual({ ok: true });
    expect(validateIdentityCardDraft(cardToDraft(FIXTURE_CARD))).toEqual({ ok: true });
  });

  it.each([
    ['outfit only', draftWith({ 'outfit.top': 'shirt' }), 'identityCard.errNoTrait'],
    ['style only', draftWith({ style: 'business' }), 'identityCard.errNoTrait'],
    ['an unknown style', draftWith({ 'face.eyes': 'green', style: 'bikini' }), 'identityCard.errGeneric'],
    ['one_piece with top', draftWith({ 'face.eyes': 'green', 'outfit.one_piece': 'dress', 'outfit.top': 'shirt' }), 'identityCard.errOnePiece'],
    ['identity words in the outfit', draftWith({ 'face.eyes': 'green', 'outfit.top': 'shirt over muscular body' }), 'identityCard.errOutfitIdentity'],
    ['identity words in one_piece', draftWith({ 'face.eyes': 'green', 'outfit.one_piece': 'dress over muscular body' }), 'identityCard.errOutfitIdentity'],
    ['sexualised clothing', draftWith({ 'face.eyes': 'green', 'outfit.top': 'lingerie' }), 'identityCard.errContent'],
    ['sexualised clothing in one_piece', draftWith({ 'face.eyes': 'green', 'outfit.one_piece': 'lingerie' }), 'identityCard.errContent'],
    ['a value over 80 characters', draftWith({ 'face.eyes': 'x'.repeat(81) }), 'identityCard.errField'],
  ])('maps %s to its localized key', (_name, draft, key) => {
    expect(validateIdentityCardDraft(draft)).toEqual({ ok: false, errorKey: key });
  });
});

describe('identityCardErrorKey', () => {
  it('maps server messages to keys and never returns the raw text', () => {
    expect(identityCardErrorKey('identityCard.defaults.outfit.one_piece: cannot be combined with top or bottom')).toBe('identityCard.errOnePiece');
    expect(identityCardErrorKey('identityCard.defaults.outfit.one_piece: must describe clothing only, not the person (face, hair, skin, body)')).toBe('identityCard.errOutfitIdentity');
    expect(identityCardErrorKey('identityCard.defaults.outfit.one_piece: nude or sexualised clothing is not allowed')).toBe('identityCard.errContent');
    expect(identityCardErrorKey('identityCard.identity: must hold at least one trait')).toBe('identityCard.errNoTrait');
    expect(identityCardErrorKey('identityCard.defaults.outfit.top: nude or sexualised clothing is not allowed')).toBe('identityCard.errContent');
    expect(identityCardErrorKey('identityCard.identity.face.eyes: at most 80 characters')).toBe('identityCard.errField');
    expect(identityCardErrorKey('identityCard: not valid JSON')).toBe('identityCard.errGeneric');
    expect(identityCardErrorKey('identityCard: at most 4096 bytes')).toBe('identityCard.errTooLarge');
    expect(identityCardErrorKey('identityCard: too large to store (at most 4096 bytes; accented or non-Latin text uses more bytes)')).toBe('identityCard.errTooLarge');
    expect(identityCardErrorKey('identityCard.defaults: must name a style or an outfit')).toBe('identityCard.errStyleOrOutfit');
  });
});

describe('identityCardErrorKey stays in sync with the real parsers', () => {
  function keyOf(result: ParsedCardInput<IdentityCard>): string {
    expect(result.ok).toBe(false);
    if (result.ok) return 'identityCard.errGeneric';
    return identityCardErrorKey(result.error);
  }

  it.each([
    ['a one-piece with a top', { version: 2, identity: { face: { eyes: 'green' } }, defaults: { outfit: { one_piece: 'dress', top: 'tee' } } }, 'identityCard.errOnePiece'],
    ['a card with no trait', { version: 2, identity: {}, defaults: { style: 'casual' } }, 'identityCard.errNoTrait'],
    ['a card with neither style nor outfit', { version: 2, identity: { face: { eyes: 'green' } }, defaults: {} }, 'identityCard.errStyleOrOutfit'],
    ['sexualised clothing', { version: 2, identity: { face: { eyes: 'green' } }, defaults: { outfit: { top: 'lingerie' } } }, 'identityCard.errContent'],
    ['identity words in the outfit', { version: 2, identity: { face: { eyes: 'green' } }, defaults: { outfit: { top: 'shirt over muscular body' } } }, 'identityCard.errOutfitIdentity'],
    ['an empty value', { version: 2, identity: { face: { eyes: '' } }, defaults: { style: 'casual' } }, 'identityCard.errField'],
    ['a value over 80 characters', { version: 2, identity: { face: { eyes: 'x'.repeat(81) } }, defaults: { style: 'casual' } }, 'identityCard.errField'],
    ['a value with a control character', { version: 2, identity: { face: { eyes: 'a\nb' } }, defaults: { style: 'casual' } }, 'identityCard.errField'],
  ])('maps %s to %s', (_name, card, key) => {
    expect(keyOf(parseIdentityCardValue(card))).toBe(key);
  });

  it('maps an oversized stored value to errTooLarge', () => {
    const longValue = 'あ'.repeat(80);
    const card = {
      version: 2,
      identity: {
        face: {
          eyes: longValue, eye_color: longValue, eyebrows: longValue, nose: longValue, lips: longValue,
          teeth: longValue, smile: longValue, skin: longValue, jawline: longValue, cheekbones: longValue,
          chin: longValue, forehead: longValue, ears: longValue,
          hair: { color: longValue, style: longValue, texture: longValue, parting: longValue },
          facial_hair: longValue, marks: longValue, tattoos: longValue,
        },
        body: {
          build: longValue, height: longValue, shoulders: longValue, arms: longValue, hands: longValue,
          waist: longValue, hips: longValue, legs: longValue, posture: longValue, proportions: longValue,
        },
      },
      defaults: { style: 'casual', outfit: { top: longValue, bottom: longValue, footwear: longValue, accessories: longValue } },
    };
    const result = parseIdentityCardValue(card);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('too large to store');
    expect(keyOf(result)).toBe('identityCard.errTooLarge');
  });

  it('maps an oversized raw JSON string to errTooLarge', () => {
    const raw = `${JSON.stringify(FIXTURE_CARD_V2)}${' '.repeat(5000)}`;
    expect(keyOf(parseIdentityCardJson(raw))).toBe('identityCard.errTooLarge');
  });

  it('maps unparseable JSON to errGeneric', () => {
    expect(keyOf(parseIdentityCardJson('not json'))).toBe('identityCard.errGeneric');
  });
});

describe('localizeIdentityCardResult', () => {
  const t = (key: string): string => `t(${key})`;

  it('replaces an identity card server error with its localized text', () => {
    expect(localizeIdentityCardResult({ success: false, error: 'identityCard.identity.face.eyes: at most 80 characters' }, t)).toEqual({
      success: false,
      error: 't(identityCard.errField)',
    });
  });

  it('leaves every other result untouched', () => {
    const other = { success: false, error: 'Invalid niche: use at most 300 characters.' };
    expect(localizeIdentityCardResult(other, t)).toBe(other);
    const ok = { success: true };
    expect(localizeIdentityCardResult(ok, t)).toBe(ok);
  });
});
