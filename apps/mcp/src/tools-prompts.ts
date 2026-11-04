import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withTracking } from './analytics.js';
import { HUB_PROMPTS } from './prompts.js';
import type { McpToolResponse } from './tools-call.js';

//---------------
// Recipe self-serve tools: list_prompts and get_prompt.
//
// Slash commands are a user channel: an agent that arrives without a human
// typing /place-spotlight only sees the tool list and tool results, so it
// never learns the recipes exist. These two tools put the hub in that
// channel: list_prompts advertises what recipes exist (slugs + titles +
// descriptions, no prompt text — cheap in tokens), and get_prompt fetches
// one recipe's full text by slug. Both wrap HUB_PROMPTS, the same
// single source the MCP slash commands register from.
//---------------

//---------------
// Server instructions, advertised in the MCP initialize result. An agent
// that reads the initialize payload sees the nudge before its first call;
// tools see it only in their descriptions (see generate_persona_video).
//---------------
export const SERVER_INSTRUCTIONS = [
  'post-engineer turns user content into scheduled persona videos.',
  'If the user asks for a video about a topic — news, a place, a product, GitHub PRs, or needs first-time setup — call list_prompts first and follow the matching recipe with get_prompt instead of improvising the script: recipes pre-validate the script, media, and price facts before any token is spent.',
].join(' ');

export const ListPromptsShape = {};

export async function handleListPrompts(): Promise<McpToolResponse> {
  const prompts = HUB_PROMPTS.map((prompt) => ({
    slug: prompt.slug,
    title: prompt.title,
    description: prompt.description,
  }));
  return {
    content: [{ type: 'text', text: JSON.stringify(prompts, null, 2) }],
  };
}

export const GetPromptShape = {
  slug: z
    .string()
    .min(1, 'slug is required')
    .describe(
      `Prompt slug from list_prompts. Valid slugs: ${HUB_PROMPTS.map((prompt) => prompt.slug).join(', ')}.`,
    ),
};

const GetPromptSchema = z.object(GetPromptShape);

export async function handleGetPrompt(args: unknown): Promise<McpToolResponse> {
  const parsed = GetPromptSchema.safeParse(args);
  if (!parsed.success) {
    return unknownSlugResponse(args);
  }
  const prompt = HUB_PROMPTS.find((entry) => entry.slug === parsed.data.slug);
  if (prompt === undefined) {
    return unknownSlugResponse(parsed.data.slug);
  }
  return {
    content: [{ type: 'text', text: prompt.prompt }],
  };
}

function unknownSlugResponse(slug: unknown): McpToolResponse {
  return {
    content: [
      {
        type: 'text',
        text: `Error getting prompt: unknown prompt slug ${JSON.stringify(slug)}. Valid slugs: ${HUB_PROMPTS.map((entry) => entry.slug).join(', ')}.`,
      },
    ],
    isError: true,
  };
}

//---------------
// Registration lives here (not in index.ts) so the file-size ratchet does
// not push index.ts over the cap: index.ts pays one import line and one
// call for the whole pair.
//---------------
export function registerPromptTools(server: McpServer): void {
  server.tool(
    'list_prompts',
    'List the recipe prompts the server can run: one entry per recipe with slug, title, and description. Call this first when the user asks for a video about a topic (news, a place, a product, GitHub PRs) or when no script exists yet — the matching recipe pre-validates the script before tokens are spent. Fetch the chosen recipe with get_prompt.',
    ListPromptsShape,
    withTracking('list_prompts', async () => handleListPrompts()),
  );
  server.tool(
    'get_prompt',
    'Get one recipe prompt by its slug (from list_prompts) as ready-to-run instructions: the full validated flow, including script limits, media checks, and the generation call. Unknown slugs return an error naming the valid slugs.',
    GetPromptShape,
    withTracking('get_prompt', async (args) => handleGetPrompt(args)),
  );
}
