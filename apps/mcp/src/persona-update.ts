import { z } from 'zod';

import type { PostEngineerClient } from './client.js';
import { VIDEO_LAYOUTS } from './client.js';
import { FACE_QUALITIES, VIDEO_ASPECTS } from './contracts/personas.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';
import { isEnglishLanguage, ONLY_ENGLISH_VIDEOS_MESSAGE } from './language.js';
import { PersonaCtaShape } from './persona-cta-shape.js';
import { IdentityCardField } from './persona-card-actions.js';
import { refinePersonaAvatar, UpdatePersonaAvatarFields } from './persona-avatar.js';
import { personaVoiceField, withResolvedPersonaVoiceForUpdate } from './voice-filters.js';

export const UpdatePersonaShape = {
  personaId: z.string().min(1, 'personaId is required').describe('The ID of the persona to update'),
  name: z.string().min(1).optional().describe('New name for the persona'),
  ...UpdatePersonaAvatarFields,
  voiceId: personaVoiceField().optional().describe('New voice id or label from voices (action: list). Never type a provider prefix.'),
  language: z
    .string()
    .refine(isEnglishLanguage, { message: ONLY_ENGLISH_VIDEOS_MESSAGE })
    .optional()
    .describe('New language code — English only for now (e.g. en-US, en-GB)'),
  videoAspect: z.enum(VIDEO_ASPECTS).optional().describe('New video aspect ratio'),
  videoLayout: z.enum(VIDEO_LAYOUTS).optional().describe('New persona-hook layout (standard or react)'),
  hookPanel: z
    .boolean()
    .optional()
    .describe('New hook_lipsync default: true shows the photo panel under the face during the hook, false keeps the face alone.'),
  aiLabel: z.boolean().optional(),
  scriptPrompt: z.string().optional().describe('New system prompt instructions for video scripts'),
  paragraphNumber: z.number().int().min(1).max(10).optional().describe('New number of paragraphs'),
  niche: z.string().max(300).optional().describe('New content niche'),
  faceQuality: z
    .enum(FACE_QUALITIES)
    .optional()
    .describe('New face resolution of the rendered videos: ok (480p, 2 tokens/video) or very_good (720p, 3 tokens/video). Future videos price at the new quality; already-scheduled posts keep the quality they were charged for.'),
  cta: PersonaCtaShape.optional(),
  identityCard: IdentityCardField.nullable().optional().describe('New identity card (replaces the stored one), or null to remove it. Omit to leave it unchanged. See persona_media (action: render_prompt) to render prompts from it.'),
};

export const UpdatePersonaSchema = z.object(UpdatePersonaShape).superRefine(refinePersonaAvatar(false));

export async function handleUpdatePersona(
  client: PostEngineerClient,
  args: z.infer<typeof UpdatePersonaSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(
    async () => client.updatePersona(await withResolvedPersonaVoiceForUpdate(client, UpdatePersonaSchema.parse(args))),
    'updating persona', 'Persona updated successfully',
  );
}
