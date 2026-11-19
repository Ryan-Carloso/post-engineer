import { z } from 'zod';
import { defineEndpoint } from './endpoint.js';

//---------------
// Tool Config (issue #669): per-user research/stock tool configuration.
// The single source of truth for the GET/PUT /api/tool-config exchange.
// The route re-validates strictly (lib/tool-config.ts): a key is only
// accepted for the tool/source it belongs to, and nothing is truncated,
// coerced, or dropped. These schemas describe the exchange shape only.
//---------------

export const ToolConfigSearchToolSchema = z.enum(['tavily', 'exa']);
export type ToolConfigSearchTool = z.infer<typeof ToolConfigSearchToolSchema>;

export const ToolConfigStockSourceSchema = z.enum(['pexels', 'pixabay', 'coverr']);
export type ToolConfigStockSource = z.infer<typeof ToolConfigStockSourceSchema>;

export const ToolConfigKeyNamesSchema = z.enum(['tavily', 'exa', 'pexels', 'pixabay', 'coverr']);

// Keys are optional per name: only the configured tools carry one. The
// 512-character cap is the lib's validation bound, pinned here too. Strict:
// an unknown key name fails fast instead of being stripped silently —
// a typo'd key would otherwise vanish while the save reports success.
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

// Replace-whole save: every field is required, so a partial write can
// never leave a stale key behind for a tool the user just removed.
export const SaveToolConfigBodySchema = z.object({
  searchTool: ToolConfigSearchToolSchema.nullable(),
  stockSources: z.array(ToolConfigStockSourceSchema),
  keys: ToolConfigKeysSchema,
});
export type SaveToolConfigBody = z.infer<typeof SaveToolConfigBodySchema>;

// GET returns presence only — never a key value. The keys are stored
// encrypted as the vault of record; what a later session needs to know is
// which tools are configured, and the agent calls those APIs with the keys
// from its own environment.
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

// PUT returns presence only: each key as present + its last 4 characters,
// never a key value.
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

//---------------
// Endpoints.
//---------------
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
