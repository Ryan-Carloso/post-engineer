import {
  IDENTITY_CARD_MAX_BYTES,
  IDENTITY_CARD_WRITE_VERSION,
  parseIdentityCardJson,
  parseIdentityCardValue,
  type IdentityCard,
  type ParsedCardInput,
} from './contracts/persona-identity-card';

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

export function cardToText(card: IdentityCard | null): string {
  if (card === null) return '';
  if (card.version === 3 && card.defaults === undefined) return card.identity.description;
  const pretty = JSON.stringify(card, null, 2);
  if (new TextEncoder().encode(pretty).length <= IDENTITY_CARD_MAX_BYTES) return pretty;
  return JSON.stringify(card);
}

function descriptionCard(text: string): IdentityCard {
  return { version: IDENTITY_CARD_WRITE_VERSION, identity: { description: normalizeText(text) } };
}

export function parseCardText(text: string): ParsedCardInput<IdentityCard | null> {
  const value = normalizeText(text);
  if (value === '') return { ok: true, value: null };
  if (!value.startsWith('{')) return { ok: true, value: descriptionCard(value) };
  return parseIdentityCardJson(value);
}

export function sameIdentityCardText(a: string, b: string): boolean {
  return normalizeText(a) === normalizeText(b);
}

export function identityCardFormValue(draft: string, loaded: string): string | null {
  if (sameIdentityCardText(draft, loaded)) return null;
  const built = parseCardText(draft);
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
  if (message.includes('must not be empty')) {
    return message.startsWith('identityCard.identity.description')
      ? 'identityCard.errDescriptionMissing'
      : 'identityCard.errGeneric';
  }
  if (message.includes('control characters') || (message.includes('at most ') && message.includes(' characters'))) {
    return 'identityCard.errField';
  }
  return 'identityCard.errGeneric';
}

export type IdentityCardTextValidation = { ok: true } | { ok: false; errorKey: IdentityCardErrorKey };

export function validateIdentityCardText(text: string): IdentityCardTextValidation {
  const built = parseCardText(text);
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
