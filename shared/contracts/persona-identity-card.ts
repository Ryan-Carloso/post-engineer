import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';
import {
  IDENTITY_CARD_MAX_BYTES,
  IDENTITY_CARD_VERSION,
  IDENTITY_TEXT_MAX_LENGTH,
  OUTFIT_SLOTS,
  SCENE_ASPECTS,
  SCENE_FRAMING,
  SCENE_LIGHTING,
  SCENE_MAX_BYTES,
} from './persona-identity-card-limits.js';

export * from './persona-identity-card-limits.js';

const IDENTITY_WORDS: ReadonlySet<string> = new Set([
  'hair', 'eye', 'eyes', 'skin', 'build', 'builds', 'height', 'heights', 'beard', 'bearded', 'muscular',
  'tattoo', 'tattoos', 'tattooed', 'freckles', 'freckled', 'body', 'bodies', 'face', 'faces', 'taller', 'thinner',
]);

const IDENTITY_STEMS: readonly string[] = ['hair', 'eye', 'skin', 'freckl', 'tattoo', 'beard'];

const IDENTITY_EXTRA_WORDS: ReadonlySet<string> = new Set([
  'blonde', 'brunette', 'redhead', 'ginger', 'bald', 'abs',
  'cabelo', 'loiro', 'loira', 'ruivo', 'ruiva', 'careca', 'calvo',
]);

function mentionsIdentity(value: string): boolean {
  const withoutWater = value.toLowerCase().replace(/\b(?:body|bodies) of water\b/g, ' ');
  return wordsOf(withoutWater).some(
    (word) =>
      IDENTITY_WORDS.has(word) ||
      IDENTITY_EXTRA_WORDS.has(word) ||
      IDENTITY_STEMS.some((stem) => word.startsWith(stem)),
  );
}

const SEXUALISED_WORDS: ReadonlySet<string> = new Set([
  'nude', 'naked', 'nudity', 'topless', 'bottomless', 'shirtless', 'lingerie', 'bikini', 'underwear', 'thong',
  'undressed', 'sexy', 'sexual', 'erotic', 'nsfw', 'revealing', 'transparent', 'sheer',
]);

function wordsOf(value: string): string[] {
  return value.toLowerCase().split(/[^a-z]+/).filter((word) => word.length > 0);
}

function mentionsAny(value: string, words: ReadonlySet<string>): boolean {
  return wordsOf(value).some((word) => words.has(word));
}

function mentionsSeeThrough(value: string): boolean {
  return /see[\s-]*through/i.test(value);
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

const freeText = z
  .string()
  .trim()
  .min(1)
  .max(IDENTITY_TEXT_MAX_LENGTH)
  .refine((value) => !hasControlCharacter(value), { message: 'must be a single line without control characters' });

const sceneText = freeText
  .refine((value) => !mentionsIdentity(value), {
    message: 'must describe the scene only, not the person (face, hair, skin, body)',
  })
  .refine((value) => !mentionsAny(value, SEXUALISED_WORDS) && !mentionsSeeThrough(value), {
    message: 'nude or sexualised content is not allowed',
  });

const OutfitSchema = z
  .strictObject({
    top: freeText.optional(),
    bottom: freeText.optional(),
    one_piece: freeText.optional(),
    outerwear: freeText.optional(),
    footwear: freeText.optional(),
    accessories: freeText.optional(),
  })
  .superRefine((outfit, ctx) => {
    const filled = OUTFIT_SLOTS.filter((slot) => outfit[slot] !== undefined);
    if (filled.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'must name at least one clothing slot' });
      return;
    }
    if (outfit.one_piece !== undefined && (outfit.top !== undefined || outfit.bottom !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['one_piece'], message: 'cannot be combined with top or bottom' });
    }
    for (const slot of filled) {
      const value = outfit[slot];
      if (value === undefined) continue;
      if (mentionsIdentity(value)) {
        ctx.addIssue({ code: 'custom', path: [slot], message: 'must describe clothing only, not the person (face, hair, skin, body)' });
      } else if (mentionsAny(value, SEXUALISED_WORDS) || mentionsSeeThrough(value)) {
        ctx.addIssue({ code: 'custom', path: [slot], message: 'nude or sexualised clothing is not allowed' });
      }
    }
  });

const HairSchema = z.strictObject({
  color: freeText.optional(),
  style: freeText.optional(),
  length: freeText.optional(),
});

const FaceSchema = z.strictObject({
  shape: freeText.optional(),
  eyes: freeText.optional(),
  eyebrows: freeText.optional(),
  nose: freeText.optional(),
  lips: freeText.optional(),
  skin: freeText.optional(),
  hair: HairSchema.optional(),
  facial_hair: freeText.optional(),
  marks: freeText.optional(),
});

const BodySchema = z.strictObject({
  build: freeText.optional(),
  height: freeText.optional(),
  shoulders: freeText.optional(),
  hands: freeText.optional(),
});

function countLeaves(value: unknown): number {
  if (typeof value === 'string') return 1;
  if (typeof value !== 'object' || value === null) return 0;
  return Object.values(value).reduce<number>((total, entry) => total + countLeaves(entry), 0);
}

const IdentitySchema = z
  .strictObject({ face: FaceSchema.optional(), body: BodySchema.optional() })
  .refine((identity) => countLeaves(identity) > 0, { message: 'must hold at least one trait' });

export const IdentityCardV1Schema = z.strictObject({
  version: z.literal(IDENTITY_CARD_VERSION),
  identity: IdentitySchema,
  defaults: z.strictObject({ outfit: OutfitSchema.optional() }).optional(),
});

export const IdentityCardSchema = z.discriminatedUnion('version', [IdentityCardV1Schema]);
export type IdentityCard = z.infer<typeof IdentityCardSchema>;
export type Outfit = z.infer<typeof OutfitSchema>;

export const SceneSchema = z.strictObject({
  outfit: OutfitSchema.optional(),
  pose: sceneText.optional(),
  setting: sceneText.optional(),
  lighting: z.enum(SCENE_LIGHTING),
  framing: z.enum(SCENE_FRAMING),
  aspect: z.enum(SCENE_ASPECTS).optional(),
});
export type Scene = z.infer<typeof SceneSchema>;

export type ParsedCardInput<T> = { ok: true; value: T } | { ok: false; error: string };

function pathLabel(root: string, path: ReadonlyArray<PropertyKey>): string {
  return path.reduce<string>(
    (label, segment) => (typeof segment === 'number' ? `${label}[${segment}]` : `${label}.${String(segment)}`),
    root,
  );
}

function describeIssue(root: string, issue: z.core.$ZodIssue): string {
  const label = pathLabel(root, issue.path);
  switch (issue.code) {
    case 'unrecognized_keys':
      return `${label}: unknown ${issue.keys.length === 1 ? 'field' : 'fields'}`;
    case 'too_big':
      return `${label}: at most ${String(issue.maximum)} characters`;
    case 'too_small':
      return `${label}: ${Number(issue.minimum) <= 1 ? 'must not be empty' : `at least ${String(issue.minimum)} characters`}`;
    case 'invalid_type':
      return `${label}: must be ${issue.expected === 'object' ? 'an object' : `a ${issue.expected}`}`;
    case 'invalid_value':
      return `${label}: not an allowed value`;
    case 'invalid_union':
      return `${label}: ${issue.path[issue.path.length - 1] === 'version' ? 'unsupported version' : 'does not match any known shape'}`;
    default:
      return `${label}: ${issue.message}`;
  }
}

function parseValue<T>(schema: z.ZodType<T>, value: unknown, root: string): ParsedCardInput<T> {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  const { issues } = result.error;
  const first = issues.find((issue) => issue.code === 'unrecognized_keys') ?? issues[0];
  return { ok: false, error: first === undefined ? `${root}: invalid` : describeIssue(root, first) };
}

function parseJson<T>(schema: z.ZodType<T>, raw: string, root: string, maxBytes: number): ParsedCardInput<T> {
  if (raw.length > maxBytes || new TextEncoder().encode(raw).length > maxBytes) {
    return { ok: false, error: `${root}: at most ${maxBytes} bytes` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: `${root}: not valid JSON` };
  }
  return parseValue(schema, parsed, root);
}

export function parseIdentityCardValue(value: unknown, root = 'identityCard'): ParsedCardInput<IdentityCard> {
  return parseValue(IdentityCardSchema, value, root);
}

export function parseIdentityCardJson(raw: string, root = 'identityCard'): ParsedCardInput<IdentityCard> {
  return parseJson(IdentityCardSchema, raw, root, IDENTITY_CARD_MAX_BYTES);
}

export function parseSceneValue(value: unknown, root = 'scene'): ParsedCardInput<Scene> {
  return parseValue(SceneSchema, value, root);
}

export function parseSceneJson(raw: string, root = 'scene'): ParsedCardInput<Scene> {
  return parseJson(SceneSchema, raw, root, SCENE_MAX_BYTES);
}

export const GetIdentityCardQuerySchema = z.object({ personaId: z.string().min(1) });

export const GetIdentityCardResponseSchema = z.object({
  success: z.literal(true),
  identityCard: IdentityCardSchema.nullable(),
});

export const RenderIdentityPromptBodySchema = z.strictObject({
  personaId: z.string().min(1),
  scene: SceneSchema,
});

export const RenderIdentityPromptResponseSchema = z.object({
  success: z.literal(true),
  prompt: z.string(),
  suggestedDescription: z.string(),
  cardVersion: z.literal(IDENTITY_CARD_VERSION),
});

export const getPersonaIdentityCard = defineEndpoint({
  method: 'GET',
  path: '/api/persona/identity-card',
  response: GetIdentityCardResponseSchema,
});

export const renderPersonaIdentityPrompt = defineEndpoint({
  method: 'POST',
  path: '/api/persona/identity-card',
  body: RenderIdentityPromptBodySchema,
  response: RenderIdentityPromptResponseSchema,
});
