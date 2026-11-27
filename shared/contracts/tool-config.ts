import { z } from 'zod';
import { defineEndpoint } from './endpoint.js';

const ToolConfigSearchToolSchema = z.enum(['tavily', 'exa', 'own']);
export type ToolConfigSearchTool = z.infer<typeof ToolConfigSearchToolSchema>;

const ToolConfigStockSourceSchema = z.enum(['pexels', 'pixabay', 'coverr']);
export type ToolConfigStockSource = z.infer<typeof ToolConfigStockSourceSchema>;

const ToolConfigKeysSchema = z
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

const GetToolConfigResponseSchema = z.object({
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

const SaveToolConfigResponseSchema = z.object({
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
