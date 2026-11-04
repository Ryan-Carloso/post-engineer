import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  McpError,
  type GetPromptResult,
  type ListPromptsResult,
} from '@modelcontextprotocol/sdk/types.js';
import { withTracking } from './analytics.js';
import type { PostEngineerClient } from './client.js';
import { UnknownPromptSlugError, getPrompt, listPrompts } from './client-prompts.js';
import { getErrorMessage } from './errors.js';

//---------------
// MCP prompts hub: slash commands for the recipe prompts, served from the
// web hub over the API (GET /api/prompts, GET /api/prompts/[slug]).
//
// The handlers are registered on the low-level server and fetch on
// demand: startup never depends on the API, a recipe edit on the web
// reaches every install on the next prompts/list, and nothing is cached
// stale. Prompts are zero-arg: the agent asks the user for values.
// A failed fetch surfaces as an MCP error to the client, never as an
// empty list. Both requests are tagged like tool calls (slash_list_prompts,
// slash_get_prompt) so the web API records slash-command usage too.
//---------------

const trackedList = withTracking('slash_list_prompts', async (client: { client: PostEngineerClient }) => listPrompts(client.client));
const trackedGet = withTracking(
  'slash_get_prompt',
  async (args: { client: PostEngineerClient; slug: string }) => getPrompt(args.client, args.slug),
);

export async function listSlashPrompts(client: PostEngineerClient): Promise<ListPromptsResult> {
  try {
    const prompts = await trackedList({ client });
    return {
      prompts: prompts.map((prompt) => ({ name: prompt.slug, title: prompt.title, description: prompt.description })),
    };
  } catch (error) {
    throw new McpError(ErrorCode.InternalError, `Failed to list prompts: ${getErrorMessage(error)}`);
  }
}

export async function getSlashPrompt(client: PostEngineerClient, slug: string): Promise<GetPromptResult> {
  try {
    const prompt = await trackedGet({ client, slug });
    return {
      description: prompt.description,
      messages: [{ role: 'user', content: { type: 'text', text: prompt.prompt } }],
    };
  } catch (error) {
    if (error instanceof UnknownPromptSlugError) {
      throw new McpError(ErrorCode.InvalidParams, error.message);
    }
    throw new McpError(ErrorCode.InternalError, `Failed to get prompt: ${getErrorMessage(error)}`);
  }
}

export function registerRemotePrompts(server: McpServer, client: PostEngineerClient): void {
  server.server.registerCapabilities({ prompts: {} });
  server.server.setRequestHandler(ListPromptsRequestSchema, async () => listSlashPrompts(client));
  server.server.setRequestHandler(GetPromptRequestSchema, async (request) => getSlashPrompt(client, request.params.name));
}
