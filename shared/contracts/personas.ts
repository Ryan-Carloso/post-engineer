import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';
import { PersonaPublishingAccountsSchema } from './accounts.js';

export const PersonaListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  avatarUrl: z.string().optional(),
  photoUrl: z.string().optional(),
  aiLabel: z.boolean(),
  boundAccounts: PersonaPublishingAccountsSchema,
});
export type PersonaListItem = z.infer<typeof PersonaListItemSchema>;

export const ListPersonasResponseSchema = z.object({
  authenticated: z.literal(true),
  personas: z.array(PersonaListItemSchema),
});

export const DeletePreviewCountsSchema = z.object({
  schedules: z.number(),
  upcomingSlots: z.number(),
  publishedSlots: z.number(),
  failedSlots: z.number(),
});
export type DeletePreviewCounts = z.infer<typeof DeletePreviewCountsSchema>;

export const GetPersonaDeletePreviewResponseSchema = z.object({
  success: z.literal(true),
  persona: z.object({
    id: z.string(),
    name: z.string(),
  }),
  counts: DeletePreviewCountsSchema,
});

export const CreatePersonaResponseSchema = z.object({
  success: z.literal(true),
  personaId: z.string(),
});

export const UpdatePersonaResponseSchema = z.object({
  success: z.literal(true),
});

export const DeletePersonaResponseSchema = z.object({
  success: z.literal(true),
});

export const CreatePersonaBodySchema = z.object({
  name: z.string().trim().min(1),
  aiLabel: z.enum(['true', 'false']).optional(),
  publishingAccounts: z.string().optional(),
});

const optionalFormText = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    schema.optional(),
  );

export const UpdatePersonaBodySchema = z
  .object({
    name: optionalFormText(z.string().trim().min(1)),
    aiLabel: optionalFormText(z.enum(['true', 'false'])),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });

export function parsePersonaIdQuery(url: string):
  | { ok: true; query: { personaId: string } }
  | { ok: false; error: string } {
  const personaId = new URL(url).searchParams.get('personaId');
  if (!personaId) return { ok: false, error: 'personaId is required.' };
  return { ok: true, query: { personaId } };
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
