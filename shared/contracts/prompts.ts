// Recipe prompt catalog contract: the single source of truth for
// GET /api/prompts and GET /api/prompts/[slug]. Both apps generate a copy
// of this file (see scripts/sync-contracts.mjs); never edit a generated copy by hand.
//
// The routes serve the web hub (PROMPTS + English recipes copy) to the MCP:
// the list carries slug/title/description only, the detail adds the full
// prompt text. Neither endpoint takes a body or a query. Unknown slug ->
// 404 PROMPT_NOT_FOUND (an ApiError on the MCP, never a 200), so the
// response schemas below cover the 200 shape only. `success` is a literal
// `true`: the MCP used to reject any other value as malformed, and the
// routes never return success:false with a 200.
import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';

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
