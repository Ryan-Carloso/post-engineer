import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';

export const PROMPT_VISIBILITIES = ['private', 'public'] as const;

export type PromptVisibility = (typeof PROMPT_VISIBILITIES)[number];

export const PromptVisibilitySchema = z.enum(PROMPT_VISIBILITIES);

export const PROMPT_SOURCES = ['official', 'own', 'community'] as const;

export const PromptSourceSchema = z.enum(PROMPT_SOURCES);

export type PromptSource = (typeof PROMPT_SOURCES)[number];

export const USER_PROMPT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const USER_PROMPT_LIMITS = {
  slug: 64,
  title: 120,
  description: 500,
  prompt: 20000,
} as const;

export const PromptSlugSchema = z
  .string()
  .max(USER_PROMPT_LIMITS.slug)
  .regex(USER_PROMPT_SLUG_PATTERN, 'Use lowercase letters, digits and hyphens, starting with a letter or digit.');

export const PromptSummarySchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  source: PromptSourceSchema,
  visibility: PromptVisibilitySchema,
});

export const PromptDetailSchema = PromptSummarySchema.extend({
  prompt: z.string(),
});

export const ListPromptsResponseSchema = z.object({
  success: z.literal(true),
  prompts: z.array(PromptSummarySchema),
});

export const GetPromptResponseSchema = z.object({
  success: z.literal(true),
  prompt: PromptDetailSchema,
});

export const CreateUserPromptBodySchema = z
  .object({
    slug: PromptSlugSchema,
    title: z.string().min(1).max(USER_PROMPT_LIMITS.title),
    description: z.string().max(USER_PROMPT_LIMITS.description).optional(),
    prompt: z.string().min(1).max(USER_PROMPT_LIMITS.prompt),
    visibility: PromptVisibilitySchema.optional(),
  })
  .strict();

export const UpdateUserPromptBodySchema = z
  .object({
    title: z.string().min(1).max(USER_PROMPT_LIMITS.title).optional(),
    description: z.string().max(USER_PROMPT_LIMITS.description).optional(),
    prompt: z.string().min(1).max(USER_PROMPT_LIMITS.prompt).optional(),
    visibility: PromptVisibilitySchema.optional(),
  })
  .strict();

export const DeleteUserPromptResponseSchema = z.object({
  success: z.literal(true),
});

export const PROMPT_SEARCH_MAX_LENGTH = 100;

export const ListPromptsQuerySchema = z
  .object({
    q: z.string().max(PROMPT_SEARCH_MAX_LENGTH).optional(),
    source: PromptSourceSchema.optional(),
  })
  .strict();

export const listPrompts = defineEndpoint({
  method: 'GET',
  path: '/api/prompts',
  query: ListPromptsQuerySchema,
  response: ListPromptsResponseSchema,
});

export const getPrompt = defineEndpoint({
  method: 'GET',
  path: '/api/prompts/:slug',
  response: GetPromptResponseSchema,
});

export const createUserPrompt = defineEndpoint({
  method: 'POST',
  path: '/api/prompts',
  body: CreateUserPromptBodySchema,
  response: GetPromptResponseSchema,
});

export const updateUserPrompt = defineEndpoint({
  method: 'PATCH',
  path: '/api/prompts/:slug',
  body: UpdateUserPromptBodySchema,
  response: GetPromptResponseSchema,
});

export const deleteUserPrompt = defineEndpoint({
  method: 'DELETE',
  path: '/api/prompts/:slug',
  response: DeleteUserPromptResponseSchema,
});
