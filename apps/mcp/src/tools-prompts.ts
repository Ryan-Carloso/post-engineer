import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { UnknownPromptSlugError, getPrompt, listPrompts } from './client-prompts.js';
import { getErrorMessage } from './errors.js';
import type { McpToolResponse } from './tools-call.js';

//---------------
// Recipe self-serve tools: list_prompts and get_prompt.
//
// Slash commands are a user channel: an agent that arrives without a human
// typing /place-spotlight only sees the tool list and tool results, so it
// never learns the recipes exist. These two tools put the hub in that
// channel: list_prompts advertises what recipes exist (slugs + titles +
// descriptions, no prompt text — cheap in tokens), and get_prompt fetches
// one recipe's full text by slug. Both read the web hub over the API
// (client-prompts.ts), the same source the slash commands use.
//---------------

//---------------
// Server instructions, advertised in the MCP initialize result. An agent
// that reads the initialize payload sees the nudge before its first call;
// tools see it only in their descriptions (see generate_persona_video).
//---------------
export const SERVER_INSTRUCTIONS = [
  'post-engineer turns content into scheduled persona videos.',
  'Every video is generated from a complete, validated script — never improvised — and generation always costs prepaid tokens.',
  'When the user asks for a video about a topic — news of the day, a real place with photos, a concrete subject like a car or a product, GitHub pull requests, or first-time setup — call list_prompts first and follow the matching recipe via get_prompt instead of assembling the script yourself.',
  'The recipes pre-validate scripts, media and prices before any token is spent.',
].join(' ');

export const ListPromptsDescription =
  'List the available recipe prompts (slug, title, description). Call this BEFORE writing or generating a video script when the user\'s request describes a topic rather than a ready script — news of the day, a real place with its own photos, a concrete subject like a car or a product, GitHub pull requests, or first-time account setup. Then call get_prompt with the matching slug to load the full validated workflow for that recipe.';

export const ListPromptsShape = {};

export async function handleListPrompts(client: PostEngineerClient): Promise<McpToolResponse> {
  try {
    const prompts = await listPrompts(client);
    return { content: [{ type: 'text', text: JSON.stringify(prompts, null, 2) }] };
  } catch (error) {
    return errorResponse('listing prompts', getErrorMessage(error));
  }
}

export const GetPromptDescription =
  'Return the full recipe prompt for one slug from list_prompts. Load only the recipe the agent will follow. Each recipe carries the complete validated workflow: script structure and word limits, media verification via check_media for photo URLs, pricing rules for the overlay badge, and the generation and publish steps. Unknown slugs fail with the list of valid slugs — call list_prompts first when unsure.';

export const GetPromptShape = {
  slug: z.string().min(1, 'slug is required').describe('Prompt slug from list_prompts.'),
};

const GetPromptSchema = z.object(GetPromptShape);

export async function handleGetPrompt(client: PostEngineerClient, args: unknown): Promise<McpToolResponse> {
  const parsed = GetPromptSchema.safeParse(args);
  if (!parsed.success) {
    return errorResponse('getting prompt', 'slug is required. Call list_prompts for the valid slugs.');
  }
  try {
    const prompt = await getPrompt(client, parsed.data.slug);
    return { content: [{ type: 'text', text: prompt.prompt }] };
  } catch (error) {
    if (error instanceof UnknownPromptSlugError) return errorResponse('getting prompt', error.message);
    return errorResponse('getting prompt', getErrorMessage(error));
  }
}

function errorResponse(action: string, message: string): McpToolResponse {
  return { content: [{ type: 'text', text: `Error ${action}: ${message}` }], isError: true };
}
