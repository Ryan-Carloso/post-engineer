import { describe, expect, it } from 'vitest';
import {
  cardToDraft,
  draftToCard,
  emptyIdentityCardDraft,
  identityCardErrorKey,
  identityCardFormValue,
  localizeIdentityCardResult,
  sameIdentityCardDraft,
  styleOfCardText,
  validateIdentityCardDraft,
  type IdentityCardDraft,
} from '../persona-identity-card-form';
import { FIXTURE_CARD, FIXTURE_CARD_V2, FIXTURE_CARD_V3 } from '@/test/identity-card-fixtures';
import {
  IDENTITY_CARD_MAX_BYTES,
  IDENTITY_DESCRIPTION_MAX_LENGTH,
  parseIdentityCardJson,
  parseIdentityCardValue,
  type IdentityCard,
  type ParsedCardInput,
} from '@/lib/contracts/persona-identity-card';

function draftWith(values: Partial<IdentityCardDraft>): IdentityCardDraft {
  return { ...emptyIdentityCardDraft(), ...values };
}

function cardOf(draft: IdentityCardDraft): IdentityCard | null {
  const built = draftToCard(draft);
  expect(built.ok).toBe(true);
  return built.ok ? built.value : null;
}

describe('identity card draft', () => {
  it('has one free-text description and one style', () => {
    expect(emptyIdentityCardDraft()).toEqual({ text: '', style: '' });
  });

  it('reads a v3 card into its description and style and writes the same card back', () => {
    const draft = cardToDraft(FIXTURE_CARD_V3);
    expect(draft).toEqual({ text: FIXTURE_CARD_V3.identity.description, style: 'business' });
    expect(cardOf(draft)).toEqual(FIXTURE_CARD_V3);
  });

  it('shows a v1 and a v2 card as editable JSON with their style', () => {
    const v2 = cardToDraft(FIXTURE_CARD_V2);
    expect(JSON.parse(v2.text)).toEqual(FIXTURE_CARD_V2);
    expect(v2.style).toBe('business');
    expect(cardOf(v2)).toEqual(FIXTURE_CARD_V2);

    const v1 = cardToDraft(FIXTURE_CARD);
    expect(JSON.parse(v1.text)).toEqual(FIXTURE_CARD);
    expect(v1.style).toBe('');
    expect(cardOf(v1)).toEqual(FIXTURE_CARD);
  });

  it('turns no card into a blank draft and a blank draft into no card', () => {
    expect(cardToDraft(null)).toEqual(emptyIdentityCardDraft());
    expect(draftToCard(emptyIdentityCardDraft())).toEqual({ ok: true, value: null });
    expect(draftToCard(draftWith({ text: '   \n ' }))).toEqual({ ok: true, value: null });
  });

  it('drops a stored style the contract does not know instead of showing an empty style', () => {
    const card = { ...FIXTURE_CARD_V2, defaults: { style: 'bikini' } } as unknown as IdentityCard;
    expect(cardToDraft(card).style).toBe('');
  });

  it('writes free text as a version 3 description, trimmed and with Unix line breaks', () => {
    expect(cardOf(draftWith({ text: '  brown eyes,\r\nsquare jaw  ' }))).toEqual({
      version: 3,
      identity: { description: 'brown eyes,\nsquare jaw' },
    });
  });

  it('adds the chosen style to the description card', () => {
    expect(cardOf(draftWith({ text: 'green eyes', style: 'sporty' }))).toEqual({
      version: 3,
      identity: { description: 'green eyes' },
      defaults: { style: 'sporty' },
    });
  });

  it('reads the style of a pasted card so the choice and the JSON agree', () => {
    expect(styleOfCardText(JSON.stringify(FIXTURE_CARD_V2))).toBe('business');
    expect(styleOfCardText(JSON.stringify(FIXTURE_CARD))).toBe('');
    expect(styleOfCardText('{not json')).toBeNull();
    expect(styleOfCardText('free text')).toBeNull();
  });

  it('keeps a pasted card untouched and overrides only its style', () => {
    expect(cardOf(draftWith({ text: JSON.stringify(FIXTURE_CARD_V2), style: 'business' }))).toEqual(FIXTURE_CARD_V2);
    expect(cardOf(draftWith({ text: JSON.stringify(FIXTURE_CARD_V2), style: 'casual' }))).toEqual({
      ...FIXTURE_CARD_V2,
      defaults: { style: 'casual', outfit: FIXTURE_CARD_V2.defaults?.outfit },
    });
  });

  it('clears the style of a pasted card when the style choice is none', () => {
    expect(cardOf(draftWith({ text: JSON.stringify(FIXTURE_CARD_V2), style: '' }))).toEqual({
      version: 2,
      identity: FIXTURE_CARD_V2.identity,
      defaults: { outfit: { top: 'white shirt', footwear: 'black loafers' } },
    });
    expect(cardOf(draftWith({ text: JSON.stringify(FIXTURE_CARD), style: '' }))).toEqual(FIXTURE_CARD);
  });

  it('upgrades a pasted v1 card to v2 when a style is chosen, keeping its outfit', () => {
    expect(cardOf(draftWith({ text: JSON.stringify(FIXTURE_CARD), style: 'formal' }))).toEqual({
      version: 2,
      identity: FIXTURE_CARD.identity,
      defaults: { style: 'formal', outfit: { top: 'sage-green t-shirt', bottom: 'jeans' } },
    });
  });

  it('reports an unparseable card instead of sending it', () => {
    const built = draftToCard(draftWith({ text: '{not json' }));
    expect(built).toEqual({ ok: false, error: 'identityCard: not valid JSON' });
  });

  it('compares drafts by normalized text and known style', () => {
    expect(sameIdentityCardDraft({ text: 'a', style: '' }, { text: ' a ', style: '' })).toBe(true);
    expect(sameIdentityCardDraft({ text: 'a', style: '' }, { text: 'b', style: '' })).toBe(false);
    expect(sameIdentityCardDraft({ text: 'a', style: 'casual' }, { text: 'a', style: '' })).toBe(false);
  });
});

describe('identityCardFormValue', () => {
  it('sends nothing when the draft is unchanged', () => {
    expect(identityCardFormValue(emptyIdentityCardDraft(), emptyIdentityCardDraft())).toBeNull();
    const loaded = cardToDraft(FIXTURE_CARD_V3);
    expect(identityCardFormValue(loaded, loaded)).toBeNull();
    expect(identityCardFormValue(draftWith({ text: ` ${loaded.text} `, style: 'business' }), loaded)).toBeNull();
  });

  it('sends the card JSON when the draft changed', () => {
    const value = identityCardFormValue(draftWith({ text: 'green eyes' }), emptyIdentityCardDraft());
    expect(JSON.parse(value ?? 'null')).toEqual({ version: 3, identity: { description: 'green eyes' } });
  });

  it('keeps a stored v1 card untouched until the user edits its text', () => {
    const loaded = cardToDraft(FIXTURE_CARD);
    expect(identityCardFormValue(cardToDraft(FIXTURE_CARD), loaded)).toBeNull();
    const edited = identityCardFormValue({ ...loaded, text: '{"version":1,"identity":{"body":{"height":"short"}}}' }, loaded);
    expect(JSON.parse(edited ?? 'null')).toEqual({ version: 1, identity: { body: { height: 'short' } } });
  });

  it('sends the JSON literal null when a stored card was emptied', () => {
    expect(identityCardFormValue(emptyIdentityCardDraft(), cardToDraft(FIXTURE_CARD))).toBe('null');
  });
});

describe('validateIdentityCardDraft', () => {
  it('accepts a blank draft, a description and a pasted card', () => {
    expect(validateIdentityCardDraft(emptyIdentityCardDraft())).toEqual({ ok: true });
    expect(validateIdentityCardDraft(draftWith({ text: 'green eyes', style: 'casual' }))).toEqual({ ok: true });
    expect(validateIdentityCardDraft(draftWith({ text: JSON.stringify(FIXTURE_CARD_V2) }))).toEqual({ ok: true });
  });

  it('ignores a style the contract does not know instead of blocking the description', () => {
    expect(cardOf(draftWith({ text: 'green eyes', style: 'bikini' }))).toEqual({
      version: 3,
      identity: { description: 'green eyes' },
    });
    expect(validateIdentityCardDraft(draftWith({ text: 'green eyes', style: 'bikini' }))).toEqual({ ok: true });
  });

  it.each([
    ['style only', draftWith({ style: 'business' }), 'identityCard.errNoTrait'],
    ['an unparseable card', draftWith({ text: '{not json' }), 'identityCard.errGeneric'],
    ['an empty description in a pasted card', draftWith({ text: '{"version":3,"identity":{"description":""}}' }), 'identityCard.errDescriptionMissing'],
    [
      'a description over the cap',
      draftWith({ text: 'x'.repeat(IDENTITY_DESCRIPTION_MAX_LENGTH + 1) }),
      'identityCard.errField',
    ],
    ['a description with a control character', draftWith({ text: 'green\u0001eyes' }), 'identityCard.errField'],
    [
      'a one-piece with a top in a pasted card',
      draftWith({ text: JSON.stringify({ version: 2, identity: { face: { eyes: 'green' } }, defaults: { outfit: { one_piece: 'dress', top: 'tee' } } }) }),
      'identityCard.errOnePiece',
    ],
    [
      'sexualised clothing in a pasted card',
      draftWith({ text: JSON.stringify({ version: 2, identity: { face: { eyes: 'green' } }, defaults: { outfit: { top: 'lingerie' } } }) }),
      'identityCard.errContent',
    ],
    [
      'identity words in a pasted outfit',
      draftWith({ text: JSON.stringify({ version: 2, identity: { face: { eyes: 'green' } }, defaults: { outfit: { top: 'shirt over muscular body' } } }) }),
      'identityCard.errOutfitIdentity',
    ],
    [
      'a pasted v2 card with empty defaults',
      draftWith({ text: JSON.stringify({ version: 2, identity: { face: { eyes: 'green' } }, defaults: {} }) }),
      'identityCard.errStyleOrOutfit',
    ],
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
    expect(identityCardErrorKey(`identityCard.identity.description: at most ${IDENTITY_DESCRIPTION_MAX_LENGTH} characters`)).toBe('identityCard.errField');
    expect(identityCardErrorKey('identityCard.identity.description: must be text without control characters')).toBe('identityCard.errField');
    expect(identityCardErrorKey('identityCard.identity.description: must not be empty')).toBe('identityCard.errDescriptionMissing');
    expect(identityCardErrorKey('identityCard.identity.face.eyes: at most 80 characters')).toBe('identityCard.errField');
    expect(identityCardErrorKey('identityCard: not valid JSON')).toBe('identityCard.errGeneric');
    expect(identityCardErrorKey(`identityCard: at most ${IDENTITY_CARD_MAX_BYTES} bytes`)).toBe('identityCard.errTooLarge');
    expect(identityCardErrorKey(`identityCard: too large to store (at most ${IDENTITY_CARD_MAX_BYTES} bytes; accented or non-Latin text uses more bytes)`)).toBe('identityCard.errTooLarge');
    expect(identityCardErrorKey('identityCard.defaults: must name a style or an outfit')).toBe('identityCard.errStyleOrOutfit');
    expect(identityCardErrorKey('identityCard.defaults: must name a style')).toBe('identityCard.errStyleOrOutfit');
  });
});

describe('identityCardErrorKey stays in sync with the real parsers', () => {
  function keyOf(result: ParsedCardInput<IdentityCard | null>): string {
    expect(result.ok).toBe(false);
    if (result.ok) return 'identityCard.errGeneric';
    return identityCardErrorKey(result.error);
  }

  it.each([
    ['a one-piece with a top', { version: 2, identity: { face: { eyes: 'green' } }, defaults: { outfit: { one_piece: 'dress', top: 'tee' } } }, 'identityCard.errOnePiece'],
    ['a v2 card with no trait', { version: 2, identity: {}, defaults: { style: 'casual' } }, 'identityCard.errNoTrait'],
    ['a v2 card with neither style nor outfit', { version: 2, identity: { face: { eyes: 'green' } }, defaults: {} }, 'identityCard.errStyleOrOutfit'],
    ['a v3 card with empty defaults', { version: 3, identity: { description: 'green eyes' }, defaults: {} }, 'identityCard.errStyleOrOutfit'],
    ['sexualised clothing', { version: 2, identity: { face: { eyes: 'green' } }, defaults: { outfit: { top: 'lingerie' } } }, 'identityCard.errContent'],
    ['identity words in the outfit', { version: 2, identity: { face: { eyes: 'green' } }, defaults: { outfit: { top: 'shirt over muscular body' } } }, 'identityCard.errOutfitIdentity'],
    ['an empty description', { version: 3, identity: { description: '' } }, 'identityCard.errDescriptionMissing'],
    ['a description over the cap', { version: 3, identity: { description: 'x'.repeat(IDENTITY_DESCRIPTION_MAX_LENGTH + 1) } }, 'identityCard.errField'],
    ['a description with a control character', { version: 3, identity: { description: 'a\u0001b' } }, 'identityCard.errField'],
    ['a value over 80 characters in a legacy card', { version: 2, identity: { face: { eyes: 'x'.repeat(81) } }, defaults: { style: 'casual' } }, 'identityCard.errField'],
  ])('maps %s to %s', (_name, card, key) => {
    expect(keyOf(parseIdentityCardValue(card))).toBe(key);
  });

  it('maps an oversized raw JSON string to errTooLarge', () => {
    const raw = `${JSON.stringify(FIXTURE_CARD_V3)}${' '.repeat(5000)}`;
    expect(keyOf(parseIdentityCardJson(raw))).toBe('identityCard.errTooLarge');
  });

  it('maps unparseable JSON to errGeneric', () => {
    expect(keyOf(parseIdentityCardJson('not json'))).toBe('identityCard.errGeneric');
  });
});

describe('localizeIdentityCardResult', () => {
  const t = (key: string): string => `t(${key})`;

  it('replaces an identity card server error with its localized text', () => {
    expect(localizeIdentityCardResult({ success: false, error: 'identityCard.identity.description: at most 800 characters' }, t)).toEqual({
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
