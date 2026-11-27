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
import { recipeRunText } from './recipe-session.js';

const trackedList = withTracking('slash_list_prompts', async (client: { client: PostEngineerClient }) => listPrompts(client.client));
const trackedGet = withTracking(
  'slash_get_prompt',
  async (args: { client: PostEngineerClient; slug: string }) => getPrompt(args.client, args.slug),
);

export async function listSlashPrompts(client: PostEngineerClient): Promise<ListPromptsResult> {
  try {
    const prompts = await trackedList({ client });
    return {
      prompts: prompts.map((prompt) => ({
        name: prompt.slug,
        title: prompt.source === 'community' && !prompt.verified ? `${prompt.title} (community)` : prompt.title,
        description: prompt.description,
      })),
    };
  } catch (error) {
    throw new McpError(ErrorCode.InternalError, `Failed to list prompts: ${getErrorMessage(error)}`);
  }
}

async function getSlashPrompt(client: PostEngineerClient, slug: string): Promise<GetPromptResult> {
  try {
    const prompt = await trackedGet({ client, slug });
    return {
      description: prompt.description,
      messages: [{ role: 'user', content: { type: 'text', text: recipeRunText(prompt) } }],
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
