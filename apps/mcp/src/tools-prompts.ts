import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { UnknownPromptSlugError, getPrompt, listPrompts } from './client-prompts.js';
import { getErrorMessage } from './errors.js';
import type { McpToolResponse } from './tools-call.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { actionDescription, actionShape, byAction } from './action-tool.js';
import { READ_ONLY } from './tool-annotations.js';
import { RecipeSession, isRecipeSlug, recipeRunText, type McpTransportKind } from './recipe-session.js';

// Re-exported so the intent modules and index.ts import the recipe wrappers from one place.
export { withRecipeNudge, withScriptOutcome, type McpTransportKind } from './recipe-session.js';

//---------------
// Recipe self-serve tools: prompts (action: list) and prompts (action: get).
//
// Slash commands are a user channel: an agent that arrives without a human
// typing /place-spotlight only sees the tool list and tool results, so it
// never learns the recipes exist. These two tools put the hub in that
// channel: prompts (action: list) advertises what recipes exist (slugs + titles +
// descriptions, no prompt text — cheap in tokens), and prompts (action: get) fetches
// one recipe's full text by slug. Both read the web hub over the API
// (client-prompts.ts), the same source the slash commands use.
//---------------

//---------------
// Server instructions, advertised in the MCP initialize result. An agent
// that reads the initialize payload sees the nudge before its first call;
// tools see it only in their descriptions (see generate_video).
//---------------
export const SERVER_INSTRUCTIONS = [
  'post-engineer turns content into scheduled persona videos.',
  'Every video is generated from a complete, validated script — never improvised — and generation always costs prepaid tokens.',
  'When the user asks for a video about a topic — news of the day, a real place with photos, a concrete subject like a car or a product, GitHub pull requests, or first-time setup — call prompts (action: list) first and follow the matching recipe via prompts (action: get) instead of assembling the script yourself.',
  'The recipes pre-validate scripts, media and prices before any token is spent.',
].join(' ');

export const ListPromptsDescription =
  'List the available recipe prompts (slug, title, description). Call this BEFORE writing or generating a video script when the user\'s request describes a topic rather than a ready script — news of the day, a real place with its own photos, a concrete subject like a car or a product, GitHub pull requests, or first-time account setup. Then call prompts (action: get) with the matching slug to load the full validated workflow for that recipe.';

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
  'Return the full recipe prompt for one slug from prompts (action: list). Load only the recipe the agent will follow, and pass its slug as recipe on generate_video. Each recipe carries the complete validated workflow: script structure and word limits, media verification via media (action: check) for photo URLs, pricing rules for the overlay badge, and the generation and publish steps. Unknown slugs fail with the list of valid slugs — call prompts (action: list) first when unsure.';

export const GetPromptShape = {
  slug: z.string().min(1, 'slug is required').describe('Prompt slug from prompts (action: list).'),
};

const GetPromptSchema = z.object(GetPromptShape);

export async function handleGetPrompt(client: PostEngineerClient, args: unknown): Promise<McpToolResponse> {
  const parsed = GetPromptSchema.safeParse(args);
  if (!parsed.success) {
    return errorResponse('getting prompt', 'slug is required. Call prompts (action: list) for the valid slugs.');
  }
  try {
    const prompt = await getPrompt(client, parsed.data.slug);
    return { content: [{ type: 'text', text: recipeRunText(prompt.slug, prompt.prompt) }] };
  } catch (error) {
    if (error instanceof UnknownPromptSlugError) return errorResponse('getting prompt', error.message);
    return errorResponse('getting prompt', getErrorMessage(error));
  }
}

function errorResponse(action: string, message: string): McpToolResponse {
  return { content: [{ type: 'text', text: `Error ${action}: ${message}` }], isError: true };
}

//---------------
// Registration lives here (index.ts only wires the intent modules). The prompts tool runs inside the server's RecipeSession: its
// requests carry the recipe-adoption headers, `list` marks the recipes as
// known, and `get` records the slug once the API returned it. Returns the
// session so the other intent modules wrap the entry and script actions with the same one.
//---------------
const PROMPTS_SPECS = { list: ListPromptsShape, get: GetPromptShape };

export function registerPromptTools(server: McpServer, client: PostEngineerClient, transport: McpTransportKind): RecipeSession {
  const session = new RecipeSession(transport);
  server.tool(
    'prompts',
    actionDescription(`${ListPromptsDescription}\n${GetPromptDescription}`, PROMPTS_SPECS),
    actionShape(PROMPTS_SPECS),
    READ_ONLY,
    byAction(
      {
        list: async () => {
          const response = await session.run(undefined, () => handleListPrompts(client));
          if (response.isError !== true) session.recordRecipesListed();
          return response;
        },
        get: async (args) => {
          const response = await session.run(args.slug, () => handleGetPrompt(client, args));
          if (response.isError !== true && isRecipeSlug(args.slug)) session.recordRecipeFetched(args.slug);
          return response;
        },
      },
      PROMPTS_SPECS,
      'prompts',
    ),
  );
  return session;
}
