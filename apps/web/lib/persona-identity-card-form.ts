import {
  CARD_STYLES,
  IDENTITY_CARD_MAX_BYTES,
  IDENTITY_CARD_WRITE_VERSION,
  parseIdentityCardJson,
  parseIdentityCardValue,
  type CardStyle,
  type IdentityCard,
  type ParsedCardInput,
} from './contracts/persona-identity-card';

export const IDENTITY_CARD_FIELDS = ['text', 'style'] as const;

export type IdentityCardFieldKey = (typeof IDENTITY_CARD_FIELDS)[number];

export interface IdentityCardDraft {
  text: string;
  style: string;
}

export function emptyIdentityCardDraft(): IdentityCardDraft {
  return { text: '', style: '' };
}

function knownStyle(value: string | undefined): CardStyle | '' {
  return CARD_STYLES.find((style) => style === value) ?? '';
}

function cardStyle(card: IdentityCard): CardStyle | '' {
  return card.version === 1 ? '' : knownStyle(card.defaults?.style);
}

export function cardToDraft(card: IdentityCard | null): IdentityCardDraft {
  if (card === null) return emptyIdentityCardDraft();
  const style = cardStyle(card);
  if (card.version === 3) return { text: card.identity.description, style };
  return { text: JSON.stringify(card, null, 2), style };
}

function normalizeDescription(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

function applyStyle(card: IdentityCard, style: CardStyle | ''): IdentityCard {
  if (card.version === 1) {
    if (style === '') return card;
    const outfit = card.defaults?.outfit;
    return outfit === undefined
      ? { version: 2, identity: card.identity, defaults: { style } }
      : { version: 2, identity: card.identity, defaults: { style, outfit } };
  }
  if (card.version === 2) {
    const outfit = card.defaults?.outfit;
    if (outfit !== undefined) {
      return style === ''
        ? { version: 2, identity: card.identity, defaults: { outfit } }
        : { version: 2, identity: card.identity, defaults: { style, outfit } };
    }
    return style === ''
      ? { version: 2, identity: card.identity }
      : { version: 2, identity: card.identity, defaults: { style } };
  }
  return style === ''
    ? { version: 3, identity: card.identity }
    : { version: 3, identity: card.identity, defaults: { style } };
}

function descriptionCard(text: string, style: CardStyle | ''): IdentityCard {
  const identity = { description: normalizeDescription(text) };
  return style === ''
    ? { version: IDENTITY_CARD_WRITE_VERSION, identity }
    : { version: IDENTITY_CARD_WRITE_VERSION, identity, defaults: { style } };
}

export function styleOfCardText(text: string): string | null {
  const trimmed = normalizeDescription(text);
  if (!trimmed.startsWith('{')) return null;
  const parsed = parseIdentityCardJson(trimmed);
  return parsed.ok ? cardStyle(parsed.value) : null;
}

export function draftToCard(draft: IdentityCardDraft): ParsedCardInput<IdentityCard | null> {
  const text = normalizeDescription(draft.text);
  const style = knownStyle(draft.style);
  if (text === '') return { ok: true, value: null };
  if (!text.startsWith('{')) return { ok: true, value: descriptionCard(text, style) };
  const parsed = parseIdentityCardJson(text);
  if (!parsed.ok) return parsed;
  return { ok: true, value: applyStyle(parsed.value, style) };
}

export function sameIdentityCardDraft(a: IdentityCardDraft, b: IdentityCardDraft): boolean {
  return normalizeDescription(a.text) === normalizeDescription(b.text) && knownStyle(a.style) === knownStyle(b.style);
}

export function identityCardFormValue(draft: IdentityCardDraft, loaded: IdentityCardDraft): string | null {
  if (sameIdentityCardDraft(draft, loaded)) return null;
  const built = draftToCard(draft);
  if (!built.ok) return null;
  return built.value === null ? 'null' : JSON.stringify(built.value);
}

export type IdentityCardErrorKey =
  | 'identityCard.errOnePiece'
  | 'identityCard.errNoTrait'
  | 'identityCard.errContent'
  | 'identityCard.errOutfitIdentity'
  | 'identityCard.errField'
  | 'identityCard.errTooLarge'
  | 'identityCard.errStyleOrOutfit'
  | 'identityCard.errDescriptionMissing'
  | 'identityCard.errGeneric';

export function identityCardErrorKey(message: string): IdentityCardErrorKey {
  if (message.includes('cannot be combined with top or bottom')) return 'identityCard.errOnePiece';
  if (message.includes('at least one trait')) return 'identityCard.errNoTrait';
  if (message.includes('style or an outfit') || message.includes('must name a style')) return 'identityCard.errStyleOrOutfit';
  if (message.includes('too large to store') || message.includes(`at most ${IDENTITY_CARD_MAX_BYTES} bytes`)) {
    return 'identityCard.errTooLarge';
  }
  if (message.includes('sexualised')) return 'identityCard.errContent';
  if (message.includes('clothing only')) return 'identityCard.errOutfitIdentity';
  if (message.includes('must not be empty')) return 'identityCard.errDescriptionMissing';
  if (message.includes('control characters') || (message.includes('at most ') && message.includes(' characters'))) {
    return 'identityCard.errField';
  }
  return 'identityCard.errGeneric';
}

export type IdentityCardDraftValidation = { ok: true } | { ok: false; errorKey: IdentityCardErrorKey };

export function validateIdentityCardDraft(draft: IdentityCardDraft): IdentityCardDraftValidation {
  if (normalizeDescription(draft.text) === '' && knownStyle(draft.style) !== '') {
    return { ok: false, errorKey: 'identityCard.errNoTrait' };
  }
  const built = draftToCard(draft);
  if (!built.ok) return { ok: false, errorKey: identityCardErrorKey(built.error) };
  if (built.value === null) return { ok: true };
  const parsed = parseIdentityCardValue(built.value);
  return parsed.ok ? { ok: true } : { ok: false, errorKey: identityCardErrorKey(parsed.error) };
}

export function localizeIdentityCardResult<T extends { success: boolean; error?: string }>(
  result: T,
  t: (key: IdentityCardErrorKey) => string,
): T {
  if (result.success || typeof result.error !== 'string' || !result.error.startsWith('identityCard')) return result;
  return { ...result, error: t(identityCardErrorKey(result.error)) };
}
