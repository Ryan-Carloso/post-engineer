import { z } from 'zod';

import { createPersonaAccountsField } from './account-shapes.js';
import {
  MAX_LIBRARY_DESCRIPTION_LENGTH,
  MAX_LIBRARY_IMAGE_MB,
  MAX_LIBRARY_IMAGES,
  MAX_LIBRARY_TAG_LENGTH,
  VIDEO_LAYOUTS,
} from './client.js';
import { FACE_QUALITIES, VIDEO_ASPECTS } from './contracts/personas.js';
import { isEnglishLanguage, ONLY_ENGLISH_VIDEOS_MESSAGE } from './language.js';
import { CreatePersonaAvatarFields, refinePersonaAvatar } from './persona-avatar.js';
import { PersonaCtaShape } from './persona-cta-shape.js';
import { personaVoiceField } from './voice-filters.js';

export const LibraryImageFields = {
  path: z.string().min(1).describe(`Local file path to the image (JPG/JPEG, PNG, or WebP, max ${MAX_LIBRARY_IMAGE_MB}MB)`),
  tag: z.string().max(MAX_LIBRARY_TAG_LENGTH).optional().describe('Short tag for deterministic per-video matching (e.g. casual, formal, gym)'),
  description: z.string().max(MAX_LIBRARY_DESCRIPTION_LENGTH).optional().describe('Description of the photo for tag/keyword matching (e.g. smiling at the beach at sunset)'),
};

const PersonaLibraryImageInputShape = z.object(LibraryImageFields);

export const CreatePersonaShape = {
  name: z.string().min(1, 'Name is required').describe('Name of the persona'),
  ...CreatePersonaAvatarFields,
  voiceId: personaVoiceField('voiceId is required').describe('id or label from voices (action: list). Never type a provider prefix.'),
  language: z
    .string()
    .refine(isEnglishLanguage, { message: ONLY_ENGLISH_VIDEOS_MESSAGE })
    .default('en-US')
    .describe('Language code — English only for now (e.g. en-US, en-GB)'),
  videoAspect: z.enum(VIDEO_ASPECTS).default('9:16').describe('Video aspect ratio'),
  videoLayout: z
    .enum(VIDEO_LAYOUTS)
    .default('standard')
    .describe(
      'How the persona hook is composed with the video material: "standard" fills the frame with the avatar, "react" splits it in half (persona on top, video material below: real clips or drawings). Same render cost either way.',
    ),
  scriptPrompt: z.string().optional().default('').describe('System prompt instructions for video scripts'),
  paragraphNumber: z.number().int().min(1).max(10).default(1).describe('Number of paragraphs'),
  niche: z.string().optional().default('General').describe('Content niche'),
  faceQuality: z.enum(FACE_QUALITIES).default('very_good').describe('Face resolution of the rendered videos: ok (480p, 2 tokens/video) or very_good (720p, 3 tokens/video)'),
  cta: PersonaCtaShape.optional(),
  accounts: createPersonaAccountsField,
  images: z.array(PersonaLibraryImageInputShape).max(MAX_LIBRARY_IMAGES).optional().describe(`Up to ${MAX_LIBRARY_IMAGES} local image files of the same person for the persona image library. Each video deterministically picks the best-matching image by tag.`),
  imagePrimaryIndex: z.number().int().min(0).max(MAX_LIBRARY_IMAGES - 1).optional().describe('Index into images[] marking the primary library image (no primary is set when omitted)'),
};

export const CreatePersonaSchema = z.object(CreatePersonaShape).superRefine(refinePersonaAvatar(true));
