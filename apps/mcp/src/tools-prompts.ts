import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { UnknownPromptSlugError, getPrompt, listPrompts } from './client-prompts.js';
import { getErrorMessage } from './errors.js';
import { PROMPT_SEARCH_MAX_LENGTH, PROMPT_SOURCES } from './contracts/prompts.js';
import type { McpToolResponse } from './tools-call.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { actionDescription, actionShape, byAction } from './action-tool.js';
import { DESTRUCTIVE } from './tool-annotations.js';
import {
  PROMPT_WRITE_SPECS,
  PromptWriteDescription,
  handleCreatePrompt,
  handleDeletePrompt,
  handleListPromptVersions,
  handleRestorePrompt,
  handleUpdatePrompt,
} from './tools-prompt-library.js';
import { RecipeSession, isRecipeSlug, recipeRunText, type McpTransportKind } from './recipe-session.js';

export { withRecipeNudge, type McpTransportKind } from './recipe-session.js';

export { SERVER_INSTRUCTIONS } from './server-instructions.js';

export const ListPromptsDescription =
  'List the available prompts (slug, title, description, source): your own and other users\' public ones. Call this BEFORE writing copy when the user\'s request describes a topic rather than ready text. Then call prompts (action: get) with the matching slug to load the full workflow for that prompt.';

export const ListPromptsShape = {
  query: z.string().max(PROMPT_SEARCH_MAX_LENGTH).optional().describe('Words to find in slug, title or description.'),
  source: z.enum(PROMPT_SOURCES).optional().describe('Only own or community prompts.'),
};

const ListPromptsSchema = z.object(ListPromptsShape);

interface ListedPrompts {
  response: McpToolResponse;
  listedAny: boolean;
}

async function fetchPromptList(client: PostEngineerClient, args: unknown): Promise<ListedPrompts> {
  const parsed = ListPromptsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      response: errorResponse('listing prompts', 'query must be at most 100 characters and source one of own, community.'),
      listedAny: false,
    };
  }
  try {
    const prompts = await listPrompts(client, parsed.data);
    return {
      response: { content: [{ type: 'text', text: JSON.stringify(prompts, null, 2) }] },
      listedAny: prompts.length > 0,
    };
  } catch (error) {
    return { response: errorResponse('listing prompts', getErrorMessage(error)), listedAny: false };
  }
}

export async function handleListPrompts(client: PostEngineerClient, args: unknown = {}): Promise<McpToolResponse> {
  return (await fetchPromptList(client, args)).response;
}

export const GetPromptDescription =
  'Return the full prompt for one slug from prompts (action: list): one of yours or a public community prompt. Load only the prompt the agent will follow, and pass its versionId as promptVersionId on publish_video (action: publish_existing, mode scheduled). Unknown slugs fail with the list of valid slugs — call prompts (action: list) first when unsure.';

export const GetPromptShape = {
  slug: z.string().min(1, 'slug is required').describe('Prompt slug: lowercase letters, digits, hyphens.'),
};

const GetPromptSchema = z.object(GetPromptShape);

interface FetchedPrompt {
  response: McpToolResponse;
  publicPrompt: boolean;
}

async function fetchPromptResponse(client: PostEngineerClient, args: unknown): Promise<FetchedPrompt> {
  const parsed = GetPromptSchema.safeParse(args);
  if (!parsed.success) {
    return { response: errorResponse('getting prompt', 'slug is required. Call prompts (action: list) for the valid slugs.'), publicPrompt: false };
  }
  try {
    const prompt = await getPrompt(client, parsed.data.slug);
    return {
      response: { content: [{ type: 'text', text: recipeRunText(prompt) }] },
      publicPrompt: prompt.visibility === 'public',
    };
  } catch (error) {
    const message = error instanceof UnknownPromptSlugError ? error.message : getErrorMessage(error);
    return { response: errorResponse('getting prompt', message), publicPrompt: false };
  }
}

export async function handleGetPrompt(client: PostEngineerClient, args: unknown): Promise<McpToolResponse> {
  return (await fetchPromptResponse(client, args)).response;
}

function errorResponse(action: string, message: string): McpToolResponse {
  return { content: [{ type: 'text', text: `Error ${action}: ${message}` }], isError: true };
}

const PROMPTS_SPECS = { list: ListPromptsShape, get: GetPromptShape, ...PROMPT_WRITE_SPECS };

export function registerPromptTools(server: McpServer, client: PostEngineerClient, transport: McpTransportKind): RecipeSession {
  const session = new RecipeSession(transport);
  server.tool(
    'prompts',
    actionDescription(`${ListPromptsDescription}\n${GetPromptDescription}\n${PromptWriteDescription}`, PROMPTS_SPECS),
    actionShape(PROMPTS_SPECS),
    DESTRUCTIVE,
    byAction(
      {
        create: async (args) => handleCreatePrompt(client, args),
        update: async (args) => handleUpdatePrompt(client, args),
        delete: async (args) => handleDeletePrompt(client, args),
        versions: async (args) => handleListPromptVersions(client, args),
        restore: async (args) => handleRestorePrompt(client, args),
        list: async (args) => {
          const listed = await session.run(undefined, () => fetchPromptList(client, args));
          if (listed.response.isError !== true && listed.listedAny) session.recordRecipesListed();
          return listed.response;
        },
        get: async (args) => {
          const fetched = await session.run(args.slug, () => fetchPromptResponse(client, args));
          if (fetched.publicPrompt && isRecipeSlug(args.slug)) {
            session.recordRecipeFetched(args.slug);
          }
          return fetched.response;
        },
      },
      PROMPTS_SPECS,
      'prompts',
    ),
  );
  return session;
}
