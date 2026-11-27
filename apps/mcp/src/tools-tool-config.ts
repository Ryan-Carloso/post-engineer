import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { getToolConfig, saveToolConfig } from './client-tool-config.js';
import { handleLibraryCall, type McpToolResponse } from './tools.js';

export const GetToolConfigShape = {};

const ToolConfigKeysShape = {
  tavily: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .describe('The Tavily API key. Only with searchTool "tavily".'),
  exa: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .describe('The Exa API key. Only with searchTool "exa".'),
  pexels: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .describe('The Pexels API key. Only when "pexels" is in stockSources.'),
  pixabay: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .describe('The Pixabay API key. Only when "pixabay" is in stockSources.'),
  coverr: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .describe('The Coverr API key. Only when "coverr" is in stockSources.'),
};

export const SaveToolConfigShape = {
  searchTool: z
    .enum(['tavily', 'exa', 'own'])
    .nullable()
    .describe('The configured search tool, or null when none is configured.'),
  stockSources: z
    .array(z.enum(['pexels', 'pixabay', 'coverr']))
    .describe('The licensed stock sources the user has keys for, in preference order.'),
  keys: z
    .object(ToolConfigKeysShape)
    .strict()
    .describe(
      'API keys for the configured tools, one per configured tool or source. ' +
        'Replaces the whole saved set: a key left out here is forgotten, so send every key the user still has for the selected search tool and stock sources. ' +
        'Keys are stored encrypted and are never returned in full — get shows presence and last 4 characters only.',
    ),
};

export const SaveToolConfigSchema = z.object(SaveToolConfigShape);

export async function handleGetToolConfig(client: PostEngineerClient): Promise<McpToolResponse> {
  return handleLibraryCall(() => getToolConfig(client), 'getting tool configuration');
}

export async function handleSaveToolConfig(
  client: PostEngineerClient,
  args: z.infer<typeof SaveToolConfigSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(
    () => saveToolConfig(client, args),
    'saving tool configuration',
    'Tool configuration saved successfully',
  );
}
