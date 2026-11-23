import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { actionDescription, actionShape, byAction } from './action-tool.js';
import type { PostEngineerClient } from './client.js';
import { DESTRUCTIVE } from './tool-annotations.js';
import {
  CreatePromptShape,
  DeletePromptShape,
  UpdatePromptShape,
  handleCreatePrompt,
  handleDeletePrompt,
  handleUpdatePrompt,
} from './tools-prompt-library.js';

const PROMPT_LIBRARY_SPECS = {
  create: CreatePromptShape,
  update: UpdatePromptShape,
  delete: DeletePromptShape,
};

export const PromptLibraryDescription = actionDescription(
  'Write your own prompts (read any prompt with prompts); private by default, only the owner can change one. Set visibility public so anyone can read it, private to keep it to this account. prompts (list, get) returns your own prompts and other users\' public ones; unverified community prompts carry a notice, verified ones do not.',
  PROMPT_LIBRARY_SPECS,
);

export function registerPromptLibraryTools(server: McpServer, client: PostEngineerClient): void {
  server.tool(
    'prompt_library',
    PromptLibraryDescription,
    actionShape(PROMPT_LIBRARY_SPECS),
    DESTRUCTIVE,
    byAction(
      {
        create: async (args) => handleCreatePrompt(client, args),
        update: async (args) => handleUpdatePrompt(client, args),
        delete: async (args) => handleDeletePrompt(client, args),
      },
      PROMPT_LIBRARY_SPECS,
      'prompt_library',
    ),
  );
}
