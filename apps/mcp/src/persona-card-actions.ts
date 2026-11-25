import { z } from 'zod';

import type { PostEngineerClient } from './client.js';
import { getPersonaIdentityCard, renderPersonaIdentityPrompt } from './client-persona-card.js';
import { IDENTITY_CARD_MAX_BYTES, IdentityCardSchema, SceneSchema } from './contracts/persona-identity-card.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';

export const IdentityCardField = IdentityCardSchema.describe(
  `The persona's identity card: a versioned JSON object { version: 1, identity: { face, body }, defaults: { outfit } } of at most ${IDENTITY_CARD_MAX_BYTES} bytes. Every level is strict (an unknown key is rejected) and every trait is one line of at most 80 characters. It describes a real person's physical traits: fill it only with their consent. The server stores it and renders prompts from it; it never generates an image.`,
);

export const GetCardShape = {};

export const RenderPromptShape = {
  scene: SceneSchema.describe(
    'Only what changes per photo: outfit (slots top, bottom, one_piece, outerwear, footwear, accessories), pose, setting, lighting, framing, aspect. Identity, face, body and version keys are rejected, and so are words about the person (hair, skin, body) in the free text.',
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
