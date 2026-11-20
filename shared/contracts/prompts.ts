import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';

export const USER_PROMPT_STATUSES = ['private', 'pending', 'approved', 'rejected'] as const;

export type UserPromptStatus = (typeof USER_PROMPT_STATUSES)[number];

export const PromptSummarySchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
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
