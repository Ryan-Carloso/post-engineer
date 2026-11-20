import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';

export const USER_PROMPT_STATUSES = ['private', 'pending', 'approved', 'rejected'] as const;

export type UserPromptStatus = (typeof USER_PROMPT_STATUSES)[number];

export const UserPromptStatusSchema = z.enum(USER_PROMPT_STATUSES);

export const PROMPT_SOURCES = ['official', 'own', 'community'] as const;

export const PromptSourceSchema = z.enum(PROMPT_SOURCES);

export type PromptSource = (typeof PROMPT_SOURCES)[number];

export const USER_PROMPT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const USER_PROMPT_LIMITS = {
  slug: 64,
  title: 120,
  description: 500,
  prompt: 20000,
  rejectionReason: 500,
} as const;

export const PROMPT_VISIBILITIES = ['public', 'private'] as const;

export const PromptVisibilitySchema = z.enum(PROMPT_VISIBILITIES);

export const PROMPT_REVIEW_DECISIONS = ['approve', 'reject'] as const;

export const PromptReviewDecisionSchema = z.enum(PROMPT_REVIEW_DECISIONS);

export const PROMPT_CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

export const PromptSlugSchema = z
  .string()
  .max(USER_PROMPT_LIMITS.slug)
  .regex(USER_PROMPT_SLUG_PATTERN, 'Use lowercase letters, digits and hyphens, starting with a letter or digit.');

export const PromptSummarySchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  source: PromptSourceSchema,
  status: UserPromptStatusSchema.nullable(),
  rejectionReason: z.string().nullable(),
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
  })
  .strict();

export const UpdateUserPromptBodySchema = z
  .object({
    title: z.string().min(1).max(USER_PROMPT_LIMITS.title).optional(),
    description: z.string().max(USER_PROMPT_LIMITS.description).optional(),
    prompt: z.string().min(1).max(USER_PROMPT_LIMITS.prompt).optional(),
  })
  .strict();

export const SetPromptVisibilityBodySchema = z.object({ visibility: PromptVisibilitySchema }).strict();

export const ReviewPromptBodySchema = z
  .object({
    decision: PromptReviewDecisionSchema,
    contentHash: z.string().regex(PROMPT_CONTENT_HASH_PATTERN),
    reason: z.string().min(1).max(USER_PROMPT_LIMITS.rejectionReason).optional(),
  })
  .strict();

export const DeleteUserPromptResponseSchema = z.object({
  success: z.literal(true),
});

export const PromptReviewEntrySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  prompt: z.string(),
  contentHash: z.string(),
  authorId: z.string(),
  requestedAt: z.string(),
});

export const ListPromptReviewQueueResponseSchema = z.object({
  success: z.literal(true),
  prompts: z.array(PromptReviewEntrySchema),
  truncated: z.boolean(),
});

export const ReviewPromptResponseSchema = z.object({
  success: z.literal(true),
  slug: z.string(),
  status: UserPromptStatusSchema,
});

export const listPrompts = defineEndpoint({
  method: 'GET',
  path: '/api/prompts',
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

export const setPromptVisibility = defineEndpoint({
  method: 'POST',
  path: '/api/prompts/:slug/visibility',
  body: SetPromptVisibilityBodySchema,
  response: GetPromptResponseSchema,
});

export const listPromptReviewQueue = defineEndpoint({
  method: 'GET',
  path: '/api/admin/prompts',
  response: ListPromptReviewQueueResponseSchema,
});

export const reviewPrompt = defineEndpoint({
  method: 'POST',
  path: '/api/admin/prompts/:id/review',
  body: ReviewPromptBodySchema,
  response: ReviewPromptResponseSchema,
});
