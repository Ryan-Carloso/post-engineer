//---------------
// Personas contract — shared by the web routes (apps/web/app/api/persona)
// and the MCP client (apps/mcp/src/client.ts). Response bodies are plain
// z.object (extra fields ignored); request bodies are the string form
// fields of the multipart/JSON payloads (files travel as binary parts and
// have no schema). The create/update routes keep their hand-rolled
// validation (multipart parsing, visual-cue and binding rules, per-field
// 400 messages) — the body schemas below mirror the field rules so the
// tool schemas can be pinned against them, they do not replace the route
// parsers.
//---------------

import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';
import { VIDEO_ASPECTS } from './media.js';
import { PersonaPublishingAccountsSchema } from './accounts.js';

// The video aspect list is shared with the media contract (same three
// ratios the media check validates); the alias keeps the persona-schema
// import sites working.
export { VIDEO_ASPECTS, VIDEO_ASPECTS as VALID_VIDEO_ASPECTS };
export type VideoAspect = (typeof VIDEO_ASPECTS)[number];

// How the persona hook is composed with the video material. Must match the
// CHECK constraint in supabase/migrations/018 and the engine's VideoLayout
// enum — persona-video-layout-migration.test.ts pins all three.
export const VIDEO_LAYOUTS = ['standard', 'react'] as const;
export type VideoLayout = (typeof VIDEO_LAYOUTS)[number];

// Face resolution of the rendered videos: ok (480p, 2 tokens/video) or
// very_good (720p, 3 tokens/video).
export const FACE_QUALITIES = ['ok', 'very_good'] as const;
export type FaceQuality = (typeof FACE_QUALITIES)[number];

// Per-persona call to action, intent only (issue #639). The persona stores
// a type plus facts — never wording: the agent writes the CTA per video.
// The type list and the fact caps mirror the DB checks (migration 071);
// persona-cta-types-migration.test.ts pins all three surfaces together.
export const PERSONA_CTA_TYPES = ['follow', 'comment', 'share', 'save', 'link', 'buy', 'other'] as const;
export type PersonaCtaType = (typeof PERSONA_CTA_TYPES)[number];
// Fact caps, mirrored by the DB checks (migration 071).
export const PERSONA_CTA_URL_MAX_LENGTH = 2048;
export const PERSONA_CTA_INSTRUCTION_MAX_LENGTH = 500;

// One persona CTA: the intent plus its facts. A link/buy CTA needs its URL;
// an other CTA needs its instruction; the other types carry no facts.
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

// Image-library caps. Mirrored by the MCP client (fail-fast before the
// round-trip) and by lib/persona-images.ts (the route-side check).
export const MAX_LIBRARY_IMAGES = 10;
export const MAX_TAG_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 500;

// Stable warning codes for image-mutation partial success. The literals
// live in lib/persona-image-select.ts (that module must stay
// dependency-free for the client bundle, so it cannot import this
// contract); they are pinned to it by contracts-shared.test.ts. The UI
// maps them through i18n; never English copy.
export const PERSONA_IMAGE_WARNING_CODES = {
  PRIMARY_SWAP_FAILED: 'primary_swap_failed',
  METADATA_SAVE_FAILED: 'metadata_save_failed',
  // The mutation committed but the follow-up row refetch failed: the true
  // row state is unconfirmed. Never report this state as a total failure —
  // the committed change is real.
  ROW_REFETCH_FAILED: 'row_refetch_failed',
} as const;
export type PersonaImageWarningCode =
  (typeof PERSONA_IMAGE_WARNING_CODES)[keyof typeof PERSONA_IMAGE_WARNING_CODES];

//---------------
// List personas — GET /api/persona/list. No `success` envelope: the route
// answers `{ authenticated: true, personas }` (a 401 answers
// `{ authenticated: false, personas: [], message }` instead).
//---------------

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

//---------------
// Faces — GET /api/persona/faces. No `success` envelope: the route answers
// `{ faces }`. The `path` field of the internal face record is not served.
//---------------

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

//---------------
// Image library — GET/POST/PATCH/DELETE /api/persona/images.
// The GET list signs each row (private bucket) and reports a failed sign
// as `image_url_error`; mutations return the raw DB row without the
// internal storage path and never sign.
//---------------

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

// Mutation rows carry no image_url and no image_path.
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

//---------------
// Delete preview — GET /api/persona/delete-preview?personaId=
//---------------

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

//---------------
// Create / update / delete persona — POST/PATCH/DELETE /api/persona
//---------------

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

//---------------
// Request bodies (string form fields; files are binary parts).
//
// Create mirrors personaFormSchema (lib/persona-schema.ts): name is
// required in create mode, the rest optional with the same caps. Route-only
// rules stay in the route: exactly one visual cue (photo XOR avatarUrl),
// the English-only language gate, and the bound-accounts requirement
// (issue #572). The imageTags/imageDescriptions JSON arrays and the
// imagePrimaryIndex digit string are parsed by form-parsing.ts.
//---------------

export const CreatePersonaBodySchema = z.object({
  name: z.string().trim().min(1),
  avatarUrl: z.string().optional(),
  voiceId: z.string().optional(),
  // Unbounded in the DB (text column), capped at the API boundary: 35 is
  // the BCP 47 max tag length.
  language: z.string().max(35).optional(),
  videoAspect: z.enum(VIDEO_ASPECTS).optional(),
  videoLayout: z.enum(VIDEO_LAYOUTS).optional(),
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

// PATCH mirrors parsePatchBody (app/api/persona/patch-body.ts). A blank
// value means "leave unchanged" (null) except ctaUrl and ctaInstruction,
// where a present but blank value clears the fact (''). paragraphNumber is
// a string here: the route parses it with parseInt, so '3x' reads as 3 —
// the parseInt semantics stay in parsePatchBody, this schema only requires
// a string.
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
    scriptPrompt: optionalFormText(z.string().max(2000)),
    ctaType: z.enum(PERSONA_CTA_TYPES).optional(),
    // No .url() here: a present-but-blank value clears the URL (''), and
    // the route's parsePatchBody enforces the URL shape on the rest.
    ctaUrl: z.string().max(PERSONA_CTA_URL_MAX_LENGTH).optional(),
    ctaInstruction: z.string().max(PERSONA_CTA_INSTRUCTION_MAX_LENGTH).optional(),
    paragraphNumber: optionalFormText(z.string()),
    niche: optionalFormText(z.string().max(300)),
    faceQuality: optionalFormText(z.enum(FACE_QUALITIES)),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });

//---------------
// Image bodies — POST/PATCH /api/persona/images
//---------------

export const AddPersonaImageBodySchema = z.object({
  personaId: z.string().min(1),
  tag: z.string().max(MAX_TAG_LENGTH).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  // The form field is a string: anything other than the exact
  // 'true'/'false' literals is a client bug.
  isPrimary: z.enum(['true', 'false']).optional(),
});

export const UpdatePersonaImageBodySchema = z
  .object({
    id: z.string().min(1),
    tag: z.string().trim().max(MAX_TAG_LENGTH).optional(),
    description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).optional(),
    // Swap-only: the server rejects isPrimary:false, so only true is
    // accepted here (the route's 400 message for false stays in the route).
    isPrimary: z.literal(true).optional(),
  })
  .refine(
    (v) => v.tag !== undefined || v.description !== undefined || v.isPrimary !== undefined,
    { message: 'Nothing to update.' },
  );

//---------------
// Query parsers — the personaId/id query params. Each route keeps its own
// error envelope (personaValidationError vs apiErrorResponse with a code),
// so the parsers return only the message.
//---------------

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

//---------------
// Endpoints
//---------------

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
