// update_persona: shape, schema and handler.
//
// Extracted from tools.ts so tools.ts stays under the file-size ratchet.
// Re-exported from tools.ts, so existing import sites (`./tools.js`) keep
// working, including the tool registration in index.ts.
import { z } from 'zod';

import type { PostEngineerClient } from './client.js';
import { VIDEO_LAYOUTS } from './client.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';
import { isEnglishLanguage, ONLY_ENGLISH_VIDEOS_MESSAGE } from './language.js';
import { refinePersonaAvatar, UpdatePersonaAvatarFields } from './persona-avatar.js';
import { personaVoiceField, withResolvedPersonaVoiceForUpdate } from './voice-filters.js';

export const UpdatePersonaShape = {
  personaId: z.string().min(1, 'personaId is required').describe('The ID of the persona to update'),
  name: z.string().min(1).optional().describe('New name for the persona'),
  ...UpdatePersonaAvatarFields,
  voiceId: personaVoiceField().optional().describe('New voice id or label from list_voices. Never type a provider prefix.'),
  language: z
    .string()
    .refine(isEnglishLanguage, { message: ONLY_ENGLISH_VIDEOS_MESSAGE })
    .optional()
    .describe('New language code — English only for now (e.g. en-US, en-GB)'),
  videoAspect: z.enum(['9:16', '16:9', '1:1']).optional().describe('New video aspect ratio'),
  videoLayout: z.enum(VIDEO_LAYOUTS).optional().describe('New persona-hook layout (standard or react)'),
  scriptPrompt: z.string().optional().describe('New system prompt instructions for video scripts'),
  paragraphNumber: z.number().int().min(1).max(10).optional().describe('New number of paragraphs'),
  niche: z.string().max(300).optional().describe('New content niche'),
  faceQuality: z
    .enum(['ok', 'very_good'])
    .optional()
    .describe('New face resolution of the rendered videos: ok (480p, 2 tokens/video) or very_good (720p, 3 tokens/video). Future videos price at the new quality; already-scheduled posts keep the quality they were charged for.'),
};

export const UpdatePersonaSchema = z.object(UpdatePersonaShape).superRefine(refinePersonaAvatar(false));

export async function handleUpdatePersona(
  client: PostEngineerClient,
  args: z.infer<typeof UpdatePersonaSchema>,
): Promise<McpToolResponse> {
  // Full-schema parse, then voice routing BEFORE the POST; no voiceId keeps the stored voice (#353).
  return handleLibraryCall(
    async () => client.updatePersona(await withResolvedPersonaVoiceForUpdate(client, UpdatePersonaSchema.parse(args))),
    'updating persona', 'Persona updated successfully',
  );
}
