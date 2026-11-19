import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';

export const VOICE_GENDERS = ['female', 'male'] as const;
export const VOICE_ACCENTS = ['us', 'gb'] as const;
export const VOICE_KINDS = ['standard', 'character', 'cloned'] as const;

export const VoiceOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().nullable(),
  provider: z.string(),
  gender: z.enum(VOICE_GENDERS).nullable(),
  accent: z.enum(VOICE_ACCENTS).nullable(),
  kind: z.enum(VOICE_KINDS),
  description: z.string().nullable(),
});

export type VoiceOption = z.infer<typeof VoiceOptionSchema>;

export const ListVoicesResponseSchema = z.object({
  voices: z.array(VoiceOptionSchema),
});

export const ClonedVoiceRowSchema = z.object({
  id: z.string(),
  status: z.string(),
  language: z.string().nullable(),
  voice_id: z.string().nullable(),
  error_code: z.string().nullable(),
  consent_at: z.string().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});

export type ClonedVoiceRow = z.infer<typeof ClonedVoiceRowSchema>;

export const ListClonedVoicesResponseSchema = z.object({
  success: z.literal(true),
  voices: z.array(ClonedVoiceRowSchema),
});

export const CreateClonedVoiceBodySchema = z.object({
  consent: z.literal('true'),
  denoise: z.enum(['true', 'false']),
  language: z.string().min(1),
});

export const CreateClonedVoiceResponseSchema = z.object({
  success: z.literal(true),
  voice: ClonedVoiceRowSchema,
});

export const GetClonedVoiceResponseSchema = z.object({
  success: z.literal(true),
  voice: ClonedVoiceRowSchema,
});

export const DeleteClonedVoiceResponseSchema = z.object({
  success: z.literal(true),
});

export const PREVIEW_TEXT_MAX_CHARS = 300;

export const PreviewVoiceBodySchema = z
  .object({
    text: z.string().trim().min(1).max(PREVIEW_TEXT_MAX_CHARS).optional(),
  })
  .strict();

export const listVoices = defineEndpoint({
  method: 'GET',
  path: '/api/persona/voices',
  response: ListVoicesResponseSchema,
});

export const listClonedVoices = defineEndpoint({
  method: 'GET',
  path: '/api/persona/cloned-voices',
  response: ListClonedVoicesResponseSchema,
});

export const createClonedVoice = defineEndpoint({
  method: 'POST',
  path: '/api/persona/cloned-voices',
  body: CreateClonedVoiceBodySchema,
  response: CreateClonedVoiceResponseSchema,
});

export const getClonedVoice = defineEndpoint({
  method: 'GET',
  path: '/api/persona/cloned-voices/:cloneId',
  response: GetClonedVoiceResponseSchema,
});

export const deleteClonedVoice = defineEndpoint({
  method: 'DELETE',
  path: '/api/persona/cloned-voices/:cloneId',
  response: DeleteClonedVoiceResponseSchema,
});
