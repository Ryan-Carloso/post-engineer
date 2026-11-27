import { z } from 'zod';

import type { PostEngineerClient } from './client.js';
import { getPersonaIdentityCard, renderPersonaIdentityPrompt } from './client-persona-card.js';
import {
  IDENTITY_CARD_MAX_BYTES,
  IDENTITY_DESCRIPTION_MAX_LENGTH,
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
    properties: { version: { type: 'integer', enum: [1, 2, 3] }, identity: { type: 'object' }, defaults: { type: 'object' } },
    required: ['version', 'identity'],
    description: `The persona's identity card: a versioned JSON object of at most ${IDENTITY_CARD_MAX_BYTES} bytes. Write version 3: { version: 3, identity: { description }, defaults?: { style? } }. description is one free-form text of at most ${IDENTITY_DESCRIPTION_MAX_LENGTH} characters (line breaks allowed) that the server uses verbatim as the Person line of the rendered prompt: face, hair, eyes, skin, body build and posture, only what is visible in the base photo and never an invented trait. defaults.style is one of ${CARD_STYLES.join(', ')}. A stored version 1 or 2 card — { version, identity: { face, body }, defaults?: { style?, outfit? } } with one line of at most 80 characters per trait and outfit slots top, bottom, one_piece, outerwear, footwear, accessories — is still accepted and rendered. Every level is strict (an unknown key is rejected). It describes a real person's physical traits: fill it only with their consent. The server stores it and renders prompts from it; it never generates an image.`,
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
