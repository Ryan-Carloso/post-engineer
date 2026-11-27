import { describe, expect, it } from 'vitest';
import {
  cardToText,
  identityCardErrorKey,
  identityCardFormValue,
  localizeIdentityCardResult,
  parseCardText,
  sameIdentityCardText,
  validateIdentityCardText,
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

function cardOf(text: string): IdentityCard | null {
  const built = parseCardText(text);
  expect(built.ok).toBe(true);
  return built.ok ? built.value : null;
}

describe('identity card text', () => {
  it('turns no card into an empty box and an empty box into no card', () => {
    expect(cardToText(null)).toBe('');
    expect(parseCardText('')).toEqual({ ok: true, value: null });
    expect(parseCardText('   \n ')).toEqual({ ok: true, value: null });
  });

  it('shows a plain v3 card as its description and writes the same card back', () => {
    const card: IdentityCard = { version: 3, identity: { description: FIXTURE_CARD_V3.identity.description } };
    expect(cardToText(card)).toBe(card.identity.description);
    expect(cardOf(cardToText(card))).toEqual(card);
  });

  it('shows a v3 card with defaults, a v1 card and a v2 card as JSON that round-trips', () => {
    for (const card of [FIXTURE_CARD_V3, FIXTURE_CARD, FIXTURE_CARD_V2]) {
      const text = cardToText(card);
      expect(JSON.parse(text)).toEqual(card);
      expect(cardOf(text)).toEqual(card);
    }
  });

  it('writes plain text as a version 3 description, trimmed and with Unix line breaks', () => {
    expect(cardOf('  brown eyes,\r\nsquare jaw  ')).toEqual({
      version: 3,
      identity: { description: 'brown eyes,\nsquare jaw' },
    });
  });

  it('keeps a pasted card exactly as written, including its style', () => {
    expect(cardOf(JSON.stringify(FIXTURE_CARD_V2))).toEqual(FIXTURE_CARD_V2);
    expect(cardOf(JSON.stringify(FIXTURE_CARD_V3))).toEqual(FIXTURE_CARD_V3);
  });

  it('keeps a v3 card that names a style as JSON so the style is not lost', () => {
    const text = cardToText(FIXTURE_CARD_V3);
    expect(JSON.parse(text).defaults.style).toBe('business');
    expect(cardOf(text)).toEqual(FIXTURE_CARD_V3);
  });

  it('accepts a description with line breaks and keeps them in the card', () => {
    expect(cardOf('brown eyes\nsquare jaw\nathletic build')).toEqual({
      version: 3,
      identity: { description: 'brown eyes\nsquare jaw\nathletic build' },
    });
  });

  it('keeps a stored v2 card as JSON with its outfit', () => {
    const text = cardToText(FIXTURE_CARD_V2);
    expect(JSON.parse(text).defaults.outfit).toEqual({ top: 'white shirt', footwear: 'black loafers' });
    expect(cardOf(text)).toEqual(FIXTURE_CARD_V2);
  });

  it('ignores whitespace around a pasted card and keeps the card unchanged', () => {
    expect(cardOf(`\n  ${JSON.stringify(FIXTURE_CARD)}  \n`)).toEqual(FIXTURE_CARD);
  });

  it('does not send anything while the pasted JSON is invalid', () => {
    expect(identityCardFormValue('{not json', '')).toBeNull();
    expect(validateIdentityCardText('{not json')).toEqual({ ok: false, errorKey: 'identityCard.errGeneric' });
  });

  it('sends a pasted v3 card with a style as the new card', () => {
    const value = identityCardFormValue(JSON.stringify(FIXTURE_CARD_V3), '');
    expect(JSON.parse(value ?? 'null')).toEqual(FIXTURE_CARD_V3);
  });

  it('reports an unparseable card instead of sending it', () => {
    expect(parseCardText('{not json')).toEqual({ ok: false, error: 'identityCard: not valid JSON' });
  });

  it('compares text by normalized value', () => {
    expect(sameIdentityCardText('a', ' a ')).toBe(true);
    expect(sameIdentityCardText('a', 'b')).toBe(false);
    expect(sameIdentityCardText('a\r\nb', 'a\nb')).toBe(true);
  });
});

describe('identityCardFormValue', () => {
  it('sends nothing when the box is unchanged', () => {
    expect(identityCardFormValue('', '')).toBeNull();
    const loaded = cardToText(FIXTURE_CARD_V3);
    expect(identityCardFormValue(loaded, loaded)).toBeNull();
    expect(identityCardFormValue(` ${loaded} `, loaded)).toBeNull();
  });

  it('sends the card JSON when the box changed', () => {
    const value = identityCardFormValue('green eyes', '');
    expect(JSON.parse(value ?? 'null')).toEqual({ version: 3, identity: { description: 'green eyes' } });
  });

  it('keeps a stored v1 card untouched until the user edits its text', () => {
    const loaded = cardToText(FIXTURE_CARD);
    expect(identityCardFormValue(cardToText(FIXTURE_CARD), loaded)).toBeNull();
    const edited = identityCardFormValue('{"version":1,"identity":{"body":{"height":"short"}}}', loaded);
    expect(JSON.parse(edited ?? 'null')).toEqual({ version: 1, identity: { body: { height: 'short' } } });
  });

  it('sends the JSON literal null when a stored card was emptied', () => {
    expect(identityCardFormValue('', cardToText(FIXTURE_CARD))).toBe('null');
  });
});

describe('validateIdentityCardText', () => {
  it('accepts an empty box, a description and a pasted card', () => {
    expect(validateIdentityCardText('')).toEqual({ ok: true });
    expect(validateIdentityCardText('green eyes')).toEqual({ ok: true });
    expect(validateIdentityCardText(JSON.stringify(FIXTURE_CARD_V2))).toEqual({ ok: true });
    expect(validateIdentityCardText(JSON.stringify(FIXTURE_CARD_V3))).toEqual({ ok: true });
  });

  it.each([
    ['an unparseable card', '{not json', 'identityCard.errGeneric'],
    ['an empty description in a pasted card', '{"version":3,"identity":{"description":""}}', 'identityCard.errDescriptionMissing'],
    ['a description over the cap', 'x'.repeat(IDENTITY_DESCRIPTION_MAX_LENGTH + 1), 'identityCard.errField'],
    ['a description with a control character', 'green\u0001eyes', 'identityCard.errField'],
    [
      'a one-piece with a top in a pasted card',
      JSON.stringify({ version: 2, identity: { face: { eyes: 'green' } }, defaults: { outfit: { one_piece: 'dress', top: 'tee' } } }),
      'identityCard.errOnePiece',
    ],
    [
      'sexualised clothing in a pasted card',
      JSON.stringify({ version: 2, identity: { face: { eyes: 'green' } }, defaults: { outfit: { top: 'lingerie' } } }),
      'identityCard.errContent',
    ],
    [
      'identity words in a pasted outfit',
      JSON.stringify({ version: 2, identity: { face: { eyes: 'green' } }, defaults: { outfit: { top: 'shirt over muscular body' } } }),
      'identityCard.errOutfitIdentity',
    ],
    [
      'a pasted v2 card with empty defaults',
      JSON.stringify({ version: 2, identity: { face: { eyes: 'green' } }, defaults: {} }),
      'identityCard.errStyleOrOutfit',
    ],
    [
      'a pasted v3 card with empty defaults',
      JSON.stringify({ version: 3, identity: { description: 'green eyes' }, defaults: {} }),
      'identityCard.errStyleOrOutfit',
    ],
    [
      'a pasted v2 card without a trait',
      JSON.stringify({ version: 2, identity: {}, defaults: { style: 'casual' } }),
      'identityCard.errNoTrait',
    ],
  ])('maps %s to its localized key', (_name, text, key) => {
    expect(validateIdentityCardText(text)).toEqual({ ok: false, errorKey: key });
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
