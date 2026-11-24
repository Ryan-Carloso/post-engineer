import { describe, expect, it } from 'vitest';
import {
  IDENTITY_CARD_FIELDS,
  cardToDraft,
  draftToCard,
  emptyIdentityCardDraft,
  identityCardErrorKey,
  identityCardFormValue,
  localizeIdentityCardResult,
  sameIdentityCardDraft,
  validateIdentityCardDraft,
} from '../persona-identity-card-form';
import { FIXTURE_CARD } from '@/test/identity-card-fixtures';

function draftWith(values: Partial<Record<(typeof IDENTITY_CARD_FIELDS)[number], string>>) {
  return { ...emptyIdentityCardDraft(), ...values };
}

describe('identity card draft', () => {
  it('lists every identity leaf and outfit slot exactly once', () => {
    expect(new Set(IDENTITY_CARD_FIELDS).size).toBe(IDENTITY_CARD_FIELDS.length);
    expect(IDENTITY_CARD_FIELDS).toHaveLength(21);
  });

  it('round-trips a full card through the draft', () => {
    expect(draftToCard(cardToDraft(FIXTURE_CARD))).toEqual(FIXTURE_CARD);
  });

  it('turns no card into a blank draft and a blank draft into no card', () => {
    expect(cardToDraft(null)).toEqual(emptyIdentityCardDraft());
    expect(draftToCard(emptyIdentityCardDraft())).toBeNull();
    expect(draftToCard(draftWith({ 'face.eyes': '   ' }))).toBeNull();
  });

  it('trims values and leaves blank fields out of the card', () => {
    expect(draftToCard(draftWith({ 'face.eyes': '  green ', 'body.height': 'tall' }))).toEqual({
      version: 1,
      identity: { face: { eyes: 'green' }, body: { height: 'tall' } },
    });
  });

  it('builds nested hair and default outfit from their flat fields', () => {
    expect(draftToCard(draftWith({ 'face.hair.color': 'black', 'outfit.top': 'shirt' }))).toEqual({
      version: 1,
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
    expect(JSON.parse(value ?? 'null')).toEqual({ version: 1, identity: { face: { eyes: 'green' } } });
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
    expect(identityCardErrorKey('identityCard: at most 4096 bytes')).toBe('identityCard.errGeneric');
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
