import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { createUserPrompt, deleteUserPrompt, listPromptVersions, restorePromptVersion, updateUserPrompt } from './client-prompt-library.js';
import {
  PROMPT_VERSION_LIST_LIMITS,
  PROMPT_VERSION_MAX,
  PROMPT_VISIBILITIES,
  USER_PROMPT_LIMITS,
  USER_PROMPT_SLUG_PATTERN,
} from './contracts/prompts.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';

const SlugField = z
  .string()
  .max(USER_PROMPT_LIMITS.slug)
  .regex(USER_PROMPT_SLUG_PATTERN)
  .describe('Prompt slug: lowercase letters, digits, hyphens.');

const TitleField = z.string().min(1).max(USER_PROMPT_LIMITS.title).describe('A short title.');

const DescriptionField = z.string().max(USER_PROMPT_LIMITS.description).describe('What the prompt is for.');

const PromptField = z.string().min(1).max(USER_PROMPT_LIMITS.prompt).describe('The prompt text.');

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

const VersionField = z.number().int().min(1).max(PROMPT_VERSION_MAX);

export const VersionsPromptShape = {
  slug: SlugField,
  version: VersionField.optional().describe(
    'Version number: versions reads this version in full, restore makes it the current text. Leave it out to list the versions, newest first, with a short preview each.',
  ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(PROMPT_VERSION_LIST_LIMITS.max)
    .optional()
    .describe(`How many versions to list (default ${PROMPT_VERSION_LIST_LIMITS.default}, max ${PROMPT_VERSION_LIST_LIMITS.max}).`),
  before: z
    .number()
    .int()
    .min(2)
    .max(PROMPT_VERSION_MAX)
    .optional()
    .describe('List versions older than this one. Pass the nextCursor of the previous page.'),
};

export const RestorePromptShape = {
  slug: SlugField,
  version: VersionField.describe('The version whose text becomes the current text.'),
  expectedCurrentVersion: VersionField.describe(
    'The currentVersion you saw in versions. The restore is refused when the prompt changed since.',
  ),
};

function invalid(action: string, message: string): McpToolResponse {
  return { content: [{ type: 'text', text: `Error in prompts · ${action}: ${message}` }], isError: true };
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

export async function handleListPromptVersions(
  client: PostEngineerClient,
  args: z.infer<z.ZodObject<typeof VersionsPromptShape>>,
): Promise<McpToolResponse> {
  const { slug, ...options } = args;
  if (options.version !== undefined && (options.limit !== undefined || options.before !== undefined)) {
    return invalid('versions', 'version reads one version; limit and before page the list. Send one or the other.');
  }
  return handleLibraryCall(() => listPromptVersions(client, slug, options), 'listing prompt versions');
}

export async function handleRestorePrompt(
  client: PostEngineerClient,
  args: z.infer<z.ZodObject<typeof RestorePromptShape>>,
): Promise<McpToolResponse> {
  return handleLibraryCall(
    () => restorePromptVersion(client, args.slug, args.version, args.expectedCurrentVersion),
    'restoring prompt version',
    (result) => (result.restored ? `Prompt restored as version ${result.prompt.version}` : 'Already the current text; nothing changed'),
  );
}

export const PROMPT_WRITE_SPECS = {
  create: CreatePromptShape,
  update: UpdatePromptShape,
  delete: DeletePromptShape,
  versions: VersionsPromptShape,
  restore: RestorePromptShape,
};

export const PromptWriteDescription =
  'list and get read prompts; create, update, delete and restore write your own; versions only reads your own history. A prompt slug cannot change after creation. Prompts are private by default and only the owner can change one. Set visibility public so anyone can read a prompt, private to keep it to this account. Unverified community prompts carry a notice, verified ones do not. versions lists the saved texts of your own prompt, newest first, with a short preview and the currentVersion (pass version to read one in full); only the owner can read the history. restore makes an old version the current text by writing it as a new version: pass the currentVersion from versions as expectedCurrentVersion, and the restore is refused if the prompt changed since. The title stays as it is. Experiment results count the new version separately from the old one, even with the same text.';
