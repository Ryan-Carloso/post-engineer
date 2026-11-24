import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { actionDescription, actionShape, byAction } from './action-tool.js';
import type { PostEngineerClient } from './client.js';
import { DESTRUCTIVE } from './tool-annotations.js';
import {
  CreatePromptShape,
  DeletePromptShape,
  RestorePromptShape,
  UpdatePromptShape,
  VersionsPromptShape,
  handleCreatePrompt,
  handleDeletePrompt,
  handleListPromptVersions,
  handleRestorePrompt,
  handleUpdatePrompt,
} from './tools-prompt-library.js';

const PROMPT_LIBRARY_SPECS = {
  create: CreatePromptShape,
  update: UpdatePromptShape,
  delete: DeletePromptShape,
  versions: VersionsPromptShape,
  restore: RestorePromptShape,
};

export const PromptLibraryDescription = actionDescription(
  'Write your own prompts (read any prompt with prompts); private by default, only the owner can change one. Set visibility public so anyone can read it, private to keep it to this account. prompts (list, get) returns your own prompts and other users\' public ones; unverified community prompts carry a notice, verified ones do not. versions lists the saved texts of your own prompt, newest first, with a short preview and the currentVersion (pass version to read one in full); only the owner can read the history. restore makes an old version the current text by writing it as a new version: pass the currentVersion from versions as expectedCurrentVersion, and the restore is refused if the prompt changed since. The title stays as it is. Experiment results count the new version separately from the old one, even with the same text.',
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
        versions: async (args) => handleListPromptVersions(client, args),
        restore: async (args) => handleRestorePrompt(client, args),
      },
      PROMPT_LIBRARY_SPECS,
      'prompt_library',
    ),
  );
}
