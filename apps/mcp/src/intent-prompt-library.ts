import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { actionDescription, actionShape, byAction } from './action-tool.js';
import type { PostEngineerClient } from './client.js';
import { DESTRUCTIVE } from './tool-annotations.js';
import {
  CreatePromptShape,
  DeletePromptShape,
  ReviewPromptShape,
  ReviewQueueShape,
  SetPromptVisibilityShape,
  UpdatePromptShape,
  handleCreatePrompt,
  handleDeletePrompt,
  handleReviewPrompt,
  handleReviewQueue,
  handleSetPromptVisibility,
  handleUpdatePrompt,
} from './tools-prompt-library.js';

const PROMPT_LIBRARY_SPECS = {
  create: CreatePromptShape,
  update: UpdatePromptShape,
  delete: DeletePromptShape,
  set_visibility: SetPromptVisibilityShape,
  review_queue: ReviewQueueShape,
  review: ReviewPromptShape,
};

export const PromptLibraryDescription = actionDescription(
  'Own prompts, private by default; read and follow them with prompts. update on an approved prompt sends it back to review. set_visibility public requests publication and stays private until a reviewer approves. review_queue and review are for reviewers: review applies only if the text still has the contentHash read in review_queue. Prompts from other users are unverified community content.',
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
        set_visibility: async (args) => handleSetPromptVisibility(client, args),
        review_queue: async () => handleReviewQueue(client),
        review: async (args) => handleReviewPrompt(client, args),
      },
      PROMPT_LIBRARY_SPECS,
      'prompt_library',
    ),
  );
}
