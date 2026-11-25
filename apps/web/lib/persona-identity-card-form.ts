import {
  IDENTITY_CARD_MAX_BYTES,
  OUTFIT_SLOTS,
  parseIdentityCardValue,
  type IdentityCard,
} from './contracts/persona-identity-card';

const FACE_LEAVES = ['shape', 'eyes', 'eyebrows', 'nose', 'lips', 'skin'] as const;
const HAIR_LEAVES = ['color', 'style', 'length'] as const;
const BODY_LEAVES = ['build', 'height', 'shoulders', 'hands'] as const;

export const IDENTITY_CARD_FIELDS = [
  ...FACE_LEAVES.map((leaf) => `face.${leaf}` as const),
  ...HAIR_LEAVES.map((leaf) => `face.hair.${leaf}` as const),
  'face.facial_hair',
  'face.marks',
  ...BODY_LEAVES.map((leaf) => `body.${leaf}` as const),
  ...OUTFIT_SLOTS.map((slot) => `outfit.${slot}` as const),
] as const;

export type IdentityCardFieldKey = (typeof IDENTITY_CARD_FIELDS)[number];
export type IdentityCardDraft = Record<IdentityCardFieldKey, string>;

export const IDENTITY_CARD_GROUPS: ReadonlyArray<{ id: 'face' | 'hair' | 'body' | 'outfit'; fields: readonly IdentityCardFieldKey[] }> = [
  { id: 'face', fields: ['face.shape', 'face.eyes', 'face.eyebrows', 'face.nose', 'face.lips', 'face.skin', 'face.facial_hair', 'face.marks'] },
  { id: 'hair', fields: ['face.hair.color', 'face.hair.style', 'face.hair.length'] },
  { id: 'body', fields: ['body.build', 'body.height', 'body.shoulders', 'body.hands'] },
  { id: 'outfit', fields: OUTFIT_SLOTS.map((slot) => `outfit.${slot}` as const) },
];

export function emptyIdentityCardDraft(): IdentityCardDraft {
  return Object.fromEntries(IDENTITY_CARD_FIELDS.map((key) => [key, ''])) as IdentityCardDraft;
}

function leafOf(source: unknown, path: readonly string[]): string {
  let cursor: unknown = source;
  for (const segment of path) {
    if (typeof cursor !== 'object' || cursor === null) return '';
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === 'string' ? cursor : '';
}

export function cardToDraft(card: IdentityCard | null): IdentityCardDraft {
  const draft = emptyIdentityCardDraft();
  if (card === null) return draft;
  for (const key of IDENTITY_CARD_FIELDS) {
    const [head, ...rest] = key.split('.');
    draft[key] = head === 'outfit'
      ? leafOf(card.defaults?.outfit, rest)
      : leafOf(card.identity, [head, ...rest]);
  }
  return draft;
}

function setLeaf(target: Record<string, unknown>, path: readonly string[], value: string): void {
  let cursor = target;
  for (const segment of path.slice(0, -1)) {
    const next = cursor[segment];
    if (typeof next === 'object' && next !== null) {
      cursor = next as Record<string, unknown>;
    } else {
      const created: Record<string, unknown> = {};
      cursor[segment] = created;
      cursor = created;
    }
  }
  cursor[path[path.length - 1]] = value;
}

export function draftToCard(draft: IdentityCardDraft): IdentityCard | null {
  const identity: Record<string, unknown> = {};
  const outfit: Record<string, unknown> = {};
  let filled = 0;
  for (const key of IDENTITY_CARD_FIELDS) {
    const value = draft[key].trim();
    if (value === '') continue;
    filled += 1;
    const [head, ...rest] = key.split('.');
    if (head === 'outfit') setLeaf(outfit, rest, value);
    else setLeaf(identity, [head, ...rest], value);
  }
  if (filled === 0) return null;
  const card: Record<string, unknown> = { version: 1, identity };
  if (Object.keys(outfit).length > 0) card.defaults = { outfit };
  return card as IdentityCard;
}

export function sameIdentityCardDraft(a: IdentityCardDraft, b: IdentityCardDraft): boolean {
  return IDENTITY_CARD_FIELDS.every((key) => a[key].trim() === b[key].trim());
}

export function identityCardFormValue(draft: IdentityCardDraft, loaded: IdentityCardDraft): string | null {
  if (sameIdentityCardDraft(draft, loaded)) return null;
  const card = draftToCard(draft);
  return card === null ? 'null' : JSON.stringify(card);
}

export type IdentityCardErrorKey =
  | 'identityCard.errOnePiece'
  | 'identityCard.errNoTrait'
  | 'identityCard.errContent'
  | 'identityCard.errOutfitIdentity'
  | 'identityCard.errField'
  | 'identityCard.errTooLarge'
  | 'identityCard.errStyleOrOutfit'
  | 'identityCard.errGeneric';

export function identityCardErrorKey(message: string): IdentityCardErrorKey {
  if (message.includes('cannot be combined with top or bottom')) return 'identityCard.errOnePiece';
  if (message.includes('at least one trait')) return 'identityCard.errNoTrait';
  if (message.includes('style or an outfit')) return 'identityCard.errStyleOrOutfit';
  if (message.includes('too large to store') || message.includes(`at most ${IDENTITY_CARD_MAX_BYTES} bytes`)) {
    return 'identityCard.errTooLarge';
  }
  if (message.includes('sexualised')) return 'identityCard.errContent';
  if (message.includes('clothing only')) return 'identityCard.errOutfitIdentity';
  if (message.includes('at most 80 characters') || message.includes('must not be empty') || message.includes('single line')) {
    return 'identityCard.errField';
  }
  return 'identityCard.errGeneric';
}

export type IdentityCardDraftValidation = { ok: true } | { ok: false; errorKey: IdentityCardErrorKey };

export function validateIdentityCardDraft(draft: IdentityCardDraft): IdentityCardDraftValidation {
  const card = draftToCard(draft);
  if (card === null) return { ok: true };
  const parsed = parseIdentityCardValue(card);
  return parsed.ok ? { ok: true } : { ok: false, errorKey: identityCardErrorKey(parsed.error) };
}

export function localizeIdentityCardResult<T extends { success: boolean; error?: string }>(
  result: T,
  t: (key: IdentityCardErrorKey) => string,
): T {
  if (result.success || typeof result.error !== 'string' || !result.error.startsWith('identityCard')) return result;
  return { ...result, error: t(identityCardErrorKey(result.error)) };
}
