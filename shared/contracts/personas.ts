import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';
import { VIDEO_ASPECTS } from './media.js';
import { PersonaPublishingAccountsSchema } from './accounts.js';

export { VIDEO_ASPECTS, VIDEO_ASPECTS as VALID_VIDEO_ASPECTS };
export type VideoAspect = (typeof VIDEO_ASPECTS)[number];

export const VIDEO_LAYOUTS = ['standard', 'react'] as const;
export type VideoLayout = (typeof VIDEO_LAYOUTS)[number];

export const FACE_QUALITIES = ['ok', 'very_good'] as const;
export type FaceQuality = (typeof FACE_QUALITIES)[number];

export const PERSONA_CTA_TYPES = ['follow', 'comment', 'share', 'save', 'link', 'buy', 'other'] as const;
export type PersonaCtaType = (typeof PERSONA_CTA_TYPES)[number];
export const PERSONA_CTA_URL_MAX_LENGTH = 2048;
export const PERSONA_CTA_INSTRUCTION_MAX_LENGTH = 500;

export const PersonaCtaSchema = z
  .object({
    type: z.enum(PERSONA_CTA_TYPES),
    url: z.string().url().max(PERSONA_CTA_URL_MAX_LENGTH).optional(),
    instruction: z.string().min(1).max(PERSONA_CTA_INSTRUCTION_MAX_LENGTH).optional(),
  })
  .refine(
    (cta) =>
      (cta.type === 'link' || cta.type === 'buy'
        ? cta.url !== undefined
        : cta.url === undefined) &&
      (cta.type === 'other' ? cta.instruction !== undefined : cta.instruction === undefined),
    {
      message:
        'A link/buy CTA needs its URL, an other CTA needs its instruction, and the other types carry no facts.',
    },
  );
export type PersonaCta = z.infer<typeof PersonaCtaSchema>;

export const MAX_LIBRARY_IMAGES = 10;
export const MAX_TAG_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 500;

export const PERSONA_IMAGE_WARNING_CODES = {
  PRIMARY_SWAP_FAILED: 'primary_swap_failed',
  METADATA_SAVE_FAILED: 'metadata_save_failed',
  ROW_REFETCH_FAILED: 'row_refetch_failed',
} as const;
export type PersonaImageWarningCode =
  (typeof PERSONA_IMAGE_WARNING_CODES)[keyof typeof PERSONA_IMAGE_WARNING_CODES];

export const PersonaListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  avatarUrl: z.string().optional(),
  photoUrl: z.string().optional(),
  libraryUrl: z.string().optional(),
  voiceId: z.string().optional(),
  voiceAudioUrl: z.string().optional(),
  language: z.string().optional(),
  videoAspect: z.string().optional(),
  videoLayout: z.string().optional(),
  hookPanel: z.boolean(),
  aiLabel: z.boolean(),
  scriptPrompt: z.string().optional(),
  ctaType: z.enum(PERSONA_CTA_TYPES).optional(),
  ctaUrl: z.string().max(PERSONA_CTA_URL_MAX_LENGTH).optional(),
  ctaInstruction: z.string().max(PERSONA_CTA_INSTRUCTION_MAX_LENGTH).optional(),
  paragraphNumber: z.number().optional(),
  niche: z.string().optional(),
  faceQuality: z.string().optional(),
  boundAccounts: PersonaPublishingAccountsSchema,
});
export type PersonaListItem = z.infer<typeof PersonaListItemSchema>;

export const ListPersonasResponseSchema = z.object({
  authenticated: z.literal(true),
  personas: z.array(PersonaListItemSchema),
});

export const PersonaFaceSchema = z.object({
  id: z.string(),
  url: z.string(),
  name: z.string(),
  gender: z.enum(['female', 'male']),
  age: z.number(),
  ethnicity: z.string(),
  hair: z.string(),
  description: z.string(),
});
export type PersonaFace = z.infer<typeof PersonaFaceSchema>;

export const ListFacesResponseSchema = z.object({
  faces: z.array(PersonaFaceSchema),
});

export const PersonaLibraryImageSchema = z.object({
  id: z.string(),
  tag: z.string(),
  description: z.string(),
  is_primary: z.boolean(),
  created_at: z.string(),
  image_url: z.string().nullable(),
  image_url_error: z.literal(true).optional(),
});
export type PersonaLibraryImage = z.infer<typeof PersonaLibraryImageSchema>;

export const ListPersonaImagesResponseSchema = z.object({
  success: z.literal(true),
  images: z.array(PersonaLibraryImageSchema),
});

export const PersonaImageMutationRowSchema = z.object({
  id: z.string(),
  tag: z.string(),
  description: z.string(),
  is_primary: z.boolean(),
  created_at: z.string(),
});
export type PersonaImageMutationRow = z.infer<typeof PersonaImageMutationRowSchema>;

const PersonaImageWarningsSchema = z
  .array(
    z.enum([
      PERSONA_IMAGE_WARNING_CODES.PRIMARY_SWAP_FAILED,
      PERSONA_IMAGE_WARNING_CODES.METADATA_SAVE_FAILED,
      PERSONA_IMAGE_WARNING_CODES.ROW_REFETCH_FAILED,
    ]),
  )
  .optional();

export const AddPersonaImageResponseSchema = z.object({
  success: z.literal(true),
  image: PersonaImageMutationRowSchema,
  warnings: PersonaImageWarningsSchema,
});

export const UpdatePersonaImageResponseSchema = z.object({
  success: z.literal(true),
  image: PersonaImageMutationRowSchema.nullable(),
  warnings: PersonaImageWarningsSchema,
});

export const DeletePersonaImageResponseSchema = z.object({
  success: z.literal(true),
});

export const DeletePreviewVideoSchema = z.object({
  taskId: z.string().nullable(),
  title: z.string().nullable(),
  status: z.string(),
  downloadUrl: z.string().nullable(),
});
export type DeletePreviewVideo = z.infer<typeof DeletePreviewVideoSchema>;

export const DeletePreviewCountsSchema = z.object({
  schedules: z.number(),
  upcomingSlots: z.number(),
  publishedSlots: z.number(),
  failedSlots: z.number(),
  generatedVideos: z.number(),
  personaImages: z.number(),
});
export type DeletePreviewCounts = z.infer<typeof DeletePreviewCountsSchema>;

export const GetPersonaDeletePreviewResponseSchema = z.object({
  success: z.literal(true),
  persona: z.object({
    id: z.string(),
    name: z.string(),
  }),
  counts: DeletePreviewCountsSchema,
  videos: z.array(DeletePreviewVideoSchema),
  videosTruncated: z.boolean(),
  linksIncomplete: z.boolean(),
});

export const CreatePersonaResponseSchema = z.object({
  success: z.literal(true),
  personaId: z.string(),
  imageIds: z.array(z.string()),
  warnings: PersonaImageWarningsSchema,
});

export const UpdatePersonaResponseSchema = z.object({
  success: z.literal(true),
});

export const DeletePersonaResponseSchema = z.object({
  success: z.literal(true),
});

export const CreatePersonaBodySchema = z.object({
  name: z.string().trim().min(1),
  avatarUrl: z.string().optional(),
  voiceId: z.string().optional(),
  language: z.string().max(35).optional(),
  videoAspect: z.enum(VIDEO_ASPECTS).optional(),
  videoLayout: z.enum(VIDEO_LAYOUTS).optional(),
  hookPanel: z.enum(['true', 'false']).optional(),
  aiLabel: z.enum(['true', 'false']).optional(),
  scriptPrompt: z.string().max(2000).optional(),
  ctaType: z.enum(PERSONA_CTA_TYPES).optional(),
  ctaUrl: z.string().url().max(PERSONA_CTA_URL_MAX_LENGTH).optional(),
  ctaInstruction: z.string().max(PERSONA_CTA_INSTRUCTION_MAX_LENGTH).optional(),
  niche: z.string().max(300).optional(),
  paragraphNumber: z.coerce.number().int().min(1).max(10).optional(),
  faceQuality: z.enum(FACE_QUALITIES).optional(),
  video_subject: z.string().max(300).optional(),
  publishingAccounts: z.string().optional(),
  imageTags: z.string().optional(),
  imageDescriptions: z.string().optional(),
  imagePrimaryIndex: z
    .string()
    .regex(/^\d+$/, 'imagePrimaryIndex must be a non-negative integer.')
    .optional(),
});

const optionalFormText = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    schema.optional(),
  );

export const UpdatePersonaBodySchema = z
  .object({
    name: optionalFormText(z.string().trim().min(1)),
    avatarUrl: optionalFormText(z.string()),
    voiceId: optionalFormText(z.string()),
    language: optionalFormText(z.string()),
    videoAspect: optionalFormText(z.enum(VIDEO_ASPECTS)),
    videoLayout: optionalFormText(z.enum(VIDEO_LAYOUTS)),
    hookPanel: optionalFormText(z.enum(['true', 'false'])),
    aiLabel: optionalFormText(z.enum(['true', 'false'])),
    scriptPrompt: optionalFormText(z.string().max(2000)),
    ctaType: z.enum(PERSONA_CTA_TYPES).optional(),
    ctaUrl: z.string().max(PERSONA_CTA_URL_MAX_LENGTH).optional(),
    ctaInstruction: z.string().max(PERSONA_CTA_INSTRUCTION_MAX_LENGTH).optional(),
    paragraphNumber: optionalFormText(z.string()),
    niche: optionalFormText(z.string().max(300)),
    faceQuality: optionalFormText(z.enum(FACE_QUALITIES)),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });

export const AddPersonaImageBodySchema = z.object({
  personaId: z.string().min(1),
  tag: z.string().max(MAX_TAG_LENGTH).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  isPrimary: z.enum(['true', 'false']).optional(),
});

export const UpdatePersonaImageBodySchema = z
  .object({
    id: z.string().min(1),
    tag: z.string().trim().max(MAX_TAG_LENGTH).optional(),
    description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).optional(),
    isPrimary: z.literal(true).optional(),
  })
  .refine(
    (v) => v.tag !== undefined || v.description !== undefined || v.isPrimary !== undefined,
    { message: 'Nothing to update.' },
  );

export function parsePersonaIdQuery(url: string):
  | { ok: true; query: { personaId: string } }
  | { ok: false; error: string } {
  const personaId = new URL(url).searchParams.get('personaId');
  if (!personaId) return { ok: false, error: 'personaId is required.' };
  return { ok: true, query: { personaId } };
}

export function parseListPersonaImagesQuery(url: string):
  | { ok: true; query: { personaId: string } }
  | { ok: false; error: string } {
  const personaId = new URL(url).searchParams.get('personaId');
  if (!personaId) return { ok: false, error: 'personaId is required.' };
  return { ok: true, query: { personaId } };
}

export function parseDeletePersonaImageQuery(url: string):
  | { ok: true; query: { id: string } }
  | { ok: false; error: string } {
  const id = new URL(url).searchParams.get('id');
  if (!id) return { ok: false, error: 'id is required.' };
  return { ok: true, query: { id } };
}

export const createPersona = defineEndpoint({
  method: 'POST',
  path: '/api/persona',
  body: CreatePersonaBodySchema,
  response: CreatePersonaResponseSchema,
});

export const listPersonas = defineEndpoint({
  method: 'GET',
  path: '/api/persona/list',
  response: ListPersonasResponseSchema,
});

export const listFaces = defineEndpoint({
  method: 'GET',
  path: '/api/persona/faces',
  response: ListFacesResponseSchema,
});

export const updatePersona = defineEndpoint({
  method: 'PATCH',
  path: '/api/persona',
  body: UpdatePersonaBodySchema,
  response: UpdatePersonaResponseSchema,
});

export const getPersonaDeletePreview = defineEndpoint({
  method: 'GET',
  path: '/api/persona/delete-preview',
  response: GetPersonaDeletePreviewResponseSchema,
});

export const deletePersona = defineEndpoint({
  method: 'DELETE',
  path: '/api/persona',
  response: DeletePersonaResponseSchema,
});

export const listPersonaImages = defineEndpoint({
  method: 'GET',
  path: '/api/persona/images',
  response: ListPersonaImagesResponseSchema,
});

export const addPersonaImage = defineEndpoint({
  method: 'POST',
  path: '/api/persona/images',
  body: AddPersonaImageBodySchema,
  response: AddPersonaImageResponseSchema,
});

export const updatePersonaImage = defineEndpoint({
  method: 'PATCH',
  path: '/api/persona/images',
  body: UpdatePersonaImageBodySchema,
  response: UpdatePersonaImageResponseSchema,
});

export const deletePersonaImage = defineEndpoint({
  method: 'DELETE',
  path: '/api/persona/images',
  response: DeletePersonaImageResponseSchema,
});
