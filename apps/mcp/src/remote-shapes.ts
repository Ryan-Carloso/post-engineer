import { z } from 'zod';

import { UpdatePersonaAvatarFields, refinePersonaAvatar } from './persona-avatar.js';
import { UpdatePersonaShape } from './persona-update.js';
import { CreatePersonaShape } from './tools.js';

export const CreatePersonaRemoteShape = {
  name: CreatePersonaShape.name,
  avatarUrl: z
    .string()
    .url()
    .optional()
    .describe(
      'Public URL to the persona avatar image (use persona_media (action: list_faces) for stock face URLs). Required: every persona has a face; a video without lip sync is chosen per video with generate_video options.videoType: \'voiceover\'.',
    ),
  voiceId: CreatePersonaShape.voiceId,
  language: CreatePersonaShape.language,
  videoAspect: CreatePersonaShape.videoAspect,
  videoLayout: CreatePersonaShape.videoLayout,
  hookPanel: CreatePersonaShape.hookPanel,
  scriptPrompt: CreatePersonaShape.scriptPrompt,
  paragraphNumber: CreatePersonaShape.paragraphNumber,
  niche: CreatePersonaShape.niche,
  faceQuality: CreatePersonaShape.faceQuality,
  cta: CreatePersonaShape.cta,
  identityCard: CreatePersonaShape.identityCard,
  accounts: CreatePersonaShape.accounts,
};

export const CreatePersonaRemoteSchema = z
  .object(CreatePersonaRemoteShape)
  .strict()
  .superRefine(refinePersonaAvatar(true));

export const UpdatePersonaRemoteShape = {
  personaId: UpdatePersonaShape.personaId,
  name: UpdatePersonaShape.name,
  avatarUrl: UpdatePersonaAvatarFields.avatarUrl,
  voiceId: UpdatePersonaShape.voiceId,
  language: UpdatePersonaShape.language,
  videoAspect: UpdatePersonaShape.videoAspect,
  videoLayout: UpdatePersonaShape.videoLayout,
  hookPanel: UpdatePersonaShape.hookPanel,
  scriptPrompt: UpdatePersonaShape.scriptPrompt,
  paragraphNumber: UpdatePersonaShape.paragraphNumber,
  niche: UpdatePersonaShape.niche,
  faceQuality: UpdatePersonaShape.faceQuality,
  cta: UpdatePersonaShape.cta,
  identityCard: UpdatePersonaShape.identityCard,
};

export const UpdatePersonaRemoteSchema = z
  .object(UpdatePersonaRemoteShape)
  .strict()
  .superRefine(refinePersonaAvatar(false));
