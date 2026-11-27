import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';
import {
  IDENTITY_CARD_ACCEPTED_VERSIONS,
  IDENTITY_CARD_MAX_BYTES,
  IDENTITY_DESCRIPTION_MAX_LENGTH,
  IDENTITY_TEXT_MAX_LENGTH,
  OUTFIT_SLOTS,
  SCENE_ASPECTS,
  SCENE_FRAMING,
  SCENE_LIGHTING,
  SCENE_MAX_BYTES,
} from './persona-identity-card-limits.js';
import { SEXUALISED_WORDS, mentionsAny, mentionsIdentity, mentionsSeeThrough } from './persona-identity-card-filter.js';
import { CARD_STYLES } from './persona-identity-card-styles.js';

export * from './persona-identity-card-limits.js';
export * from './persona-identity-card-styles.js';

function hasControlCharacter(value: string, allowNewline = false): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (allowNewline && code === 10) continue;
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

const descriptionText = z
  .string()
  .trim()
  .min(1)
  .max(IDENTITY_DESCRIPTION_MAX_LENGTH)
  .refine((value) => !hasControlCharacter(value, true), { message: 'must be text without control characters' });

const sceneText = freeText
  .refine((value) => !mentionsIdentity(value, true), {
    message: 'must describe the scene only, not the person (face, hair, skin, body)',
  })
  .refine((value) => !mentionsAny(value, SEXUALISED_WORDS, true) && !mentionsSeeThrough(value), {
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

const HairV2Schema = z.strictObject({
  color: freeText.optional(),
  style: freeText.optional(),
  length: freeText.optional(),
  texture: freeText.optional(),
  parting: freeText.optional(),
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

const FaceV2Schema = z.strictObject({
  shape: freeText.optional(),
  eyes: freeText.optional(),
  eye_color: freeText.optional(),
  eyebrows: freeText.optional(),
  nose: freeText.optional(),
  lips: freeText.optional(),
  teeth: freeText.optional(),
  smile: freeText.optional(),
  skin: freeText.optional(),
  jawline: freeText.optional(),
  cheekbones: freeText.optional(),
  chin: freeText.optional(),
  forehead: freeText.optional(),
  ears: freeText.optional(),
  hair: HairV2Schema.optional(),
  facial_hair: freeText.optional(),
  marks: freeText.optional(),
  tattoos: freeText.optional(),
});

const BodySchema = z.strictObject({
  build: freeText.optional(),
  height: freeText.optional(),
  shoulders: freeText.optional(),
  hands: freeText.optional(),
});

const BodyV2Schema = z.strictObject({
  build: freeText.optional(),
  height: freeText.optional(),
  shoulders: freeText.optional(),
  arms: freeText.optional(),
  hands: freeText.optional(),
  waist: freeText.optional(),
  hips: freeText.optional(),
  legs: freeText.optional(),
  posture: freeText.optional(),
  proportions: freeText.optional(),
});

function countLeaves(value: unknown): number {
  if (typeof value === 'string') return 1;
  if (typeof value !== 'object' || value === null) return 0;
  return Object.values(value).reduce<number>((total, entry) => total + countLeaves(entry), 0);
}

const IdentitySchema = z
  .strictObject({ face: FaceSchema.optional(), body: BodySchema.optional() })
  .refine((identity) => countLeaves(identity) > 0, { message: 'must hold at least one trait' });

const IdentityV2Schema = z
  .strictObject({ face: FaceV2Schema.optional(), body: BodyV2Schema.optional() })
  .refine((identity) => countLeaves(identity) > 0, { message: 'must hold at least one trait' });

export const IdentityCardV1Schema = z.strictObject({
  version: z.literal(1),
  identity: IdentitySchema,
  defaults: z
    .strictObject({ outfit: OutfitSchema.optional() })
    .optional()
    .refine((defaults) => defaults === undefined || defaults.outfit !== undefined, {
      message: 'must name an outfit',
    }),
});

export const IdentityCardV2Schema = z.strictObject({
  version: z.literal(2),
  identity: IdentityV2Schema,
  defaults: z
    .strictObject({ style: z.enum(CARD_STYLES).optional(), outfit: OutfitSchema.optional() })
    .optional()
    .refine((defaults) => defaults === undefined || defaults.style !== undefined || defaults.outfit !== undefined, {
      message: 'must name a style or an outfit',
    }),
});

const IdentityV3Schema = z.strictObject({ description: descriptionText });

export const IdentityCardV3Schema = z.strictObject({
  version: z.literal(3),
  identity: IdentityV3Schema,
  defaults: z
    .strictObject({ style: z.enum(CARD_STYLES).optional() })
    .optional()
    .refine((defaults) => defaults === undefined || defaults.style !== undefined, {
      message: 'must name a style',
    }),
});

export const IdentityCardSchema = z.discriminatedUnion('version', [
  IdentityCardV1Schema,
  IdentityCardV2Schema,
  IdentityCardV3Schema,
]);
export type IdentityCard = z.infer<typeof IdentityCardSchema>;
export type IdentityCardV1 = z.infer<typeof IdentityCardV1Schema>;
export type IdentityCardV2 = z.infer<typeof IdentityCardV2Schema>;
export type IdentityCardV3 = z.infer<typeof IdentityCardV3Schema>;
export type IdentityLeaves = z.infer<typeof IdentityV2Schema>;
export type Outfit = z.infer<typeof OutfitSchema>;

export const SceneSchema = z.strictObject({
  style: z.enum(CARD_STYLES).optional(),
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

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

const IDENTITY_CARD_TOO_LARGE = `too large to store (at most ${IDENTITY_CARD_MAX_BYTES} bytes; accented or non-Latin text uses more bytes)`;

function parseJson<T>(
  parse: (value: unknown, root: string) => ParsedCardInput<T>,
  raw: string,
  root: string,
  maxBytes: number,
): ParsedCardInput<T> {
  if (raw.length > maxBytes || byteLength(raw) > maxBytes) {
    return { ok: false, error: `${root}: at most ${maxBytes} bytes` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: `${root}: not valid JSON` };
  }
  return parse(parsed, root);
}

export function parseIdentityCardValue(value: unknown, root = 'identityCard'): ParsedCardInput<IdentityCard> {
  const parsed = parseValue(IdentityCardSchema, value, root);
  if (!parsed.ok) return parsed;
  if (byteLength(JSON.stringify(parsed.value)) > IDENTITY_CARD_MAX_BYTES) {
    return { ok: false, error: `${root}: ${IDENTITY_CARD_TOO_LARGE}` };
  }
  return parsed;
}

export function parseIdentityCardJson(raw: string, root = 'identityCard'): ParsedCardInput<IdentityCard> {
  return parseJson(parseIdentityCardValue, raw, root, IDENTITY_CARD_MAX_BYTES);
}

export function parseSceneValue(value: unknown, root = 'scene'): ParsedCardInput<Scene> {
  return parseValue(SceneSchema, value, root);
}

export function parseSceneJson(raw: string, root = 'scene'): ParsedCardInput<Scene> {
  return parseJson(parseSceneValue, raw, root, SCENE_MAX_BYTES);
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
  cardVersion: z.literal(IDENTITY_CARD_ACCEPTED_VERSIONS),
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
