import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import {
  createUserPrompt,
  deleteUserPrompt,
  listPromptReviewQueue,
  reviewPrompt,
  setPromptVisibility,
  updateUserPrompt,
} from './client-prompt-library.js';
import {
  PROMPT_CONTENT_HASH_PATTERN,
  PROMPT_REVIEW_DECISIONS,
  PROMPT_VISIBILITIES,
  USER_PROMPT_LIMITS,
  USER_PROMPT_SLUG_PATTERN,
} from './contracts/prompts.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';

const SlugField = z
  .string()
  .max(USER_PROMPT_LIMITS.slug)
  .regex(USER_PROMPT_SLUG_PATTERN)
  .describe('Prompt slug: lowercase letters, digits, hyphens. Fixed after creation.');

const TitleField = z.string().min(1).max(USER_PROMPT_LIMITS.title).describe('A short title.');

const DescriptionField = z
  .string()
  .max(USER_PROMPT_LIMITS.description)
  .describe('What the prompt is for.');

const PromptField = z
  .string()
  .min(1)
  .max(USER_PROMPT_LIMITS.prompt)
  .describe('The prompt text.');

export const CreatePromptShape = {
  slug: SlugField,
  title: TitleField,
  description: DescriptionField.optional(),
  prompt: PromptField,
};

export const UpdatePromptShape = {
  slug: SlugField,
  title: TitleField.optional(),
  description: DescriptionField.optional(),
  prompt: PromptField.optional(),
};

export const DeletePromptShape = { slug: SlugField };

export const SetPromptVisibilityShape = {
  slug: SlugField,
  visibility: z
    .enum(PROMPT_VISIBILITIES)
    .describe('"public" requests publication; "private" withdraws it.'),
};

export const ReviewQueueShape = {};

export const ReviewPromptShape = {
  id: z.string().uuid().describe('Prompt id from review_queue.'),
  decision: z.enum(PROMPT_REVIEW_DECISIONS).describe('"approve" publishes; "reject" returns it to its owner.'),
  contentHash: z
    .string()
    .regex(PROMPT_CONTENT_HASH_PATTERN)
    .describe('contentHash from review_queue; applies only if the text still has it.'),
  reason: z
    .string()
    .min(1)
    .max(USER_PROMPT_LIMITS.rejectionReason)
    .optional()
    .describe('Rejection reason shown to the owner. Required for "reject".'),
};


function invalid(action: string, message: string): McpToolResponse {
  return { content: [{ type: 'text', text: `Error in prompt_library · ${action}: ${message}` }], isError: true };
}

export async function handleCreatePrompt(
  client: PostEngineerClient,
  args: z.infer<z.ZodObject<typeof CreatePromptShape>>,
): Promise<McpToolResponse> {
  return handleLibraryCall(() => createUserPrompt(client, args), 'creating prompt', 'Prompt created (private)');
}

export async function handleUpdatePrompt(
  client: PostEngineerClient,
  args: z.infer<z.ZodObject<typeof UpdatePromptShape>>,
): Promise<McpToolResponse> {
  const { slug, ...changes } = args;
  if (Object.keys(changes).length === 0) {
    return invalid('update', 'send at least one of title, description or prompt.');
  }
  return handleLibraryCall(
    () => updateUserPrompt(client, slug, changes),
    'updating prompt',
    'Prompt updated (an approved prompt goes back to pending review)',
  );
}

export async function handleDeletePrompt(
  client: PostEngineerClient,
  args: z.infer<z.ZodObject<typeof DeletePromptShape>>,
): Promise<McpToolResponse> {
  return handleLibraryCall(() => deleteUserPrompt(client, args.slug), 'deleting prompt', 'Prompt deleted');
}

export async function handleSetPromptVisibility(
  client: PostEngineerClient,
  args: z.infer<z.ZodObject<typeof SetPromptVisibilityShape>>,
): Promise<McpToolResponse> {
  return handleLibraryCall(
    () => setPromptVisibility(client, args.slug, args.visibility),
    'setting prompt visibility',
    args.visibility === 'public' ? 'Publication requested, the prompt stays private until a reviewer approves it' : 'Prompt is private',
  );
}

export async function handleReviewQueue(client: PostEngineerClient): Promise<McpToolResponse> {
  return handleLibraryCall(() => listPromptReviewQueue(client), 'listing prompts waiting for review');
}

export async function handleReviewPrompt(
  client: PostEngineerClient,
  args: z.infer<z.ZodObject<typeof ReviewPromptShape>>,
): Promise<McpToolResponse> {
  if (args.decision === 'reject' && args.reason === undefined) {
    return invalid('review', 'a rejection needs a reason the owner can read.');
  }
  const { id, ...decision } = args;
  return handleLibraryCall(() => reviewPrompt(client, id, decision), 'reviewing prompt', 'Review recorded');
}
