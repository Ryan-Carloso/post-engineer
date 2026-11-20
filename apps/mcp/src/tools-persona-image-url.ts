import { z } from 'zod';

import type { PostEngineerClient } from './client.js';
import { addPersonaImageFromUrl } from './client-persona-image.js';
import { AddPersonaImageRemoteShape } from './remote-shapes-images.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';

export const AddPersonaImageRemoteSchema = z.object(AddPersonaImageRemoteShape);

export async function handleAddPersonaImageFromUrl(
  client: PostEngineerClient,
  args: z.infer<typeof AddPersonaImageRemoteSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(
    async () => {
      const parsed = AddPersonaImageRemoteSchema.parse(args);
      return addPersonaImageFromUrl(client, parsed.personaId, parsed);
    },
    'adding persona image',
    'Persona image added successfully',
  );
}
