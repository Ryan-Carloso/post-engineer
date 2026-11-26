import { z } from 'zod';

import type { PostEngineerClient } from './client.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';
import { IdentityCardField } from './persona-card-actions.js';
import { PersonaAvatarFields } from './persona-avatar.js';

export const UpdatePersonaShape = {
  personaId: z.string().min(1, 'personaId is required').describe('The ID of the persona to update'),
  name: z.string().min(1).optional().describe('New name for the persona'),
  ...PersonaAvatarFields,
  identityCard: IdentityCardField.nullable().optional().describe('New identity card (replaces the stored one), or null to remove it. Omit to leave it unchanged. See persona_media (action: render_prompt) to render prompts from it.'),
};

export const UpdatePersonaSchema = z.object(UpdatePersonaShape);

export async function handleUpdatePersona(
  client: PostEngineerClient,
  args: z.infer<typeof UpdatePersonaSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(
    async () => client.updatePersona(UpdatePersonaSchema.parse(args)),
    'updating persona', 'Persona updated successfully',
  );
}
