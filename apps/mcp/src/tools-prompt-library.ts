import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { createUserPrompt, deleteUserPrompt, updateUserPrompt } from './client-prompt-library.js';
import { PROMPT_VISIBILITIES, USER_PROMPT_LIMITS, USER_PROMPT_SLUG_PATTERN } from './contracts/prompts.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';

const SlugField = z
  .string()
  .max(USER_PROMPT_LIMITS.slug)
  .regex(USER_PROMPT_SLUG_PATTERN)
  .describe('Prompt slug: lowercase letters, digits, hyphens. Fixed after creation.');

const TitleField = z.string().min(1).max(USER_PROMPT_LIMITS.title).describe('A short title.');

const DescriptionField = z.string().max(USER_PROMPT_LIMITS.description).describe('What the prompt is for.');

const PromptField = z.string().min(1).max(USER_PROMPT_LIMITS.prompt).describe('Only your own steps: prompts (action: get) serves every user prompt after the shared Post Engineer rules, so never repeat them here.');

const VisibilityField = z
  .enum(PROMPT_VISIBILITIES)
  .describe('"private" (default): only this account. "public": anyone can read it.');

export const CreatePromptShape = {
  slug: SlugField,
  title: TitleField,
  description: DescriptionField.optional(),
  prompt: PromptField,
  visibility: VisibilityField.optional(),
};

export const UpdatePromptShape = {
  slug: SlugField,
  title: TitleField.optional(),
  description: DescriptionField.optional(),
  prompt: PromptField.optional(),
  visibility: VisibilityField.optional(),
};

export const DeletePromptShape = { slug: SlugField };

function invalid(action: string, message: string): McpToolResponse {
  return { content: [{ type: 'text', text: `Error in prompt_library · ${action}: ${message}` }], isError: true };
}

export async function handleCreatePrompt(
  client: PostEngineerClient,
  args: z.infer<z.ZodObject<typeof CreatePromptShape>>,
): Promise<McpToolResponse> {
  return handleLibraryCall(() => createUserPrompt(client, args), 'creating prompt', 'Prompt created');
}

export async function handleUpdatePrompt(
  client: PostEngineerClient,
  args: z.infer<z.ZodObject<typeof UpdatePromptShape>>,
): Promise<McpToolResponse> {
  const { slug, ...changes } = args;
  if (Object.keys(changes).length === 0) {
    return invalid('update', 'send at least one of title, description, prompt or visibility.');
  }
  return handleLibraryCall(() => updateUserPrompt(client, slug, changes), 'updating prompt', 'Prompt updated');
}

export async function handleDeletePrompt(
  client: PostEngineerClient,
  args: z.infer<z.ZodObject<typeof DeletePromptShape>>,
): Promise<McpToolResponse> {
  return handleLibraryCall(() => deleteUserPrompt(client, args.slug), 'deleting prompt', 'Prompt deleted');
}
