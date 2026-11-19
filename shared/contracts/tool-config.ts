import { z } from 'zod';
import { defineEndpoint } from './endpoint.js';

export const ToolConfigSearchToolSchema = z.enum(['tavily', 'exa']);
export type ToolConfigSearchTool = z.infer<typeof ToolConfigSearchToolSchema>;

export const ToolConfigStockSourceSchema = z.enum(['pexels', 'pixabay', 'coverr']);
export type ToolConfigStockSource = z.infer<typeof ToolConfigStockSourceSchema>;

export const ToolConfigKeyNamesSchema = z.enum(['tavily', 'exa', 'pexels', 'pixabay', 'coverr']);

export const ToolConfigKeysSchema = z
  .object({
    tavily: z.string().min(1).max(512).optional(),
    exa: z.string().min(1).max(512).optional(),
    pexels: z.string().min(1).max(512).optional(),
    pixabay: z.string().min(1).max(512).optional(),
    coverr: z.string().min(1).max(512).optional(),
  })
  .strict();
export type ToolConfigKeys = z.infer<typeof ToolConfigKeysSchema>;

export const SaveToolConfigBodySchema = z.object({
  searchTool: ToolConfigSearchToolSchema.nullable(),
  stockSources: z.array(ToolConfigStockSourceSchema),
  keys: ToolConfigKeysSchema,
});
export type SaveToolConfigBody = z.infer<typeof SaveToolConfigBodySchema>;

export const GetToolConfigResponseSchema = z.object({
  success: z.literal(true),
  configured: z.boolean(),
  searchTool: ToolConfigSearchToolSchema.nullable(),
  stockSources: z.array(ToolConfigStockSourceSchema),
  keysPresent: z.object({
    tavily: z.boolean(),
    exa: z.boolean(),
    pexels: z.boolean(),
    pixabay: z.boolean(),
    coverr: z.boolean(),
  }),
  keysLast4: z.object({
    tavily: z.string().nullable(),
    exa: z.string().nullable(),
    pexels: z.string().nullable(),
    pixabay: z.string().nullable(),
    coverr: z.string().nullable(),
  }),
});
export type GetToolConfigResponse = z.infer<typeof GetToolConfigResponseSchema>;

export const SaveToolConfigResponseSchema = z.object({
  success: z.literal(true),
  configured: z.literal(true),
  searchTool: ToolConfigSearchToolSchema.nullable(),
  stockSources: z.array(ToolConfigStockSourceSchema),
  keysPresent: z.object({
    tavily: z.boolean(),
    exa: z.boolean(),
    pexels: z.boolean(),
    pixabay: z.boolean(),
    coverr: z.boolean(),
  }),
  keysLast4: z.object({
    tavily: z.string().nullable(),
    exa: z.string().nullable(),
    pexels: z.string().nullable(),
    pixabay: z.string().nullable(),
    coverr: z.string().nullable(),
  }),
});
export type SaveToolConfigResponse = z.infer<typeof SaveToolConfigResponseSchema>;

export const getToolConfig = defineEndpoint({
  method: 'GET',
  path: '/api/tool-config',
  response: GetToolConfigResponseSchema,
});

export const saveToolConfig = defineEndpoint({
  method: 'PUT',
  path: '/api/tool-config',
  body: SaveToolConfigBodySchema,
  response: SaveToolConfigResponseSchema,
});
