import { z } from 'zod';

import type { PostEngineerClient } from './client.js';
import { getPersonaIdentityCard, renderPersonaIdentityPrompt } from './client-persona-card.js';
import {
  IDENTITY_CARD_MAX_BYTES,
  CARD_STYLES,
  IdentityCardSchema,
  SceneSchema,
} from './contracts/persona-identity-card.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';

export const IdentityCardField = z
  .unknown()
  .pipe(IdentityCardSchema)
  .meta({
    type: 'object',
    properties: { version: { type: 'integer', enum: [1, 2] }, identity: { type: 'object' }, defaults: { type: 'object' } },
    required: ['version', 'identity'],
    description: `The persona's identity card: a versioned JSON object of at most ${IDENTITY_CARD_MAX_BYTES} bytes. Write version 2: { version: 2, identity: { face, body }, defaults: { style?, outfit? } } (a stored version 1 card has no style and is accepted too). face: shape, eyes, eye_color, eyebrows, nose, lips, teeth, smile, skin, jawline, cheekbones, chin, forehead, ears, hair { color, style, length, texture, parting }, facial_hair, marks, tattoos. body: build, height, shoulders, arms, hands, waist, hips, legs, posture, proportions. defaults.style is one of ${CARD_STYLES.join(', ')}; defaults.outfit has the slots top, bottom, one_piece, outerwear, footwear, accessories, and defaults must name a style or an outfit. Every level is strict (an unknown key is rejected) and every trait is one line of at most 80 characters. Fill only what is visible in the base photo and never invent a trait. It describes a real person's physical traits: fill it only with their consent. The server stores it and renders prompts from it; it never generates an image.`,
  });

export const GetCardShape = {};

export const RenderPromptShape = {
  scene: SceneSchema.describe(
    'Only what changes per photo: style, outfit slots, pose, setting, lighting, framing, aspect. Send style alone to change the clothing and name outfit slots only for a garment the user asked for; never write a style word in outfit, pose or setting. Identity, face, body and version keys are rejected, and so are words about the person (hair, eyes, skin, build, height, beard, tattoo, smile, teeth, arms, legs, hips, waist, posture, jawline, cheekbones, chin, forehead, ears) in the free text. A scene style drops the default outfit; a scene outfit without a style merges slot by slot over it, and with a style it stands alone.',
  ),
};

export async function handleGetPersonaCard(client: PostEngineerClient, args: { personaId: string }): Promise<McpToolResponse> {
  return handleLibraryCall(async () => getPersonaIdentityCard(client, args.personaId), 'getting persona identity card');
}

export async function handleRenderPersonaPrompt(
  client: PostEngineerClient,
  args: { personaId: string; scene: z.infer<typeof SceneSchema> },
): Promise<McpToolResponse> {
  return handleLibraryCall(
    async () => renderPersonaIdentityPrompt(client, args.personaId, SceneSchema.parse(args.scene)),
    'rendering persona identity prompt',
  );
}
