import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';
import { METRICS_WINDOWS, type MetricsWindow } from './metrics.js';

export const DEFAULT_COMPARISON_WINDOW: MetricsWindow = '7d';

export const COMPARISON_LABELS = ['insufficient', 'no_signal', 'indicative', 'clear'] as const;

export const PROMPT_VERSION_SOURCES = ['official', 'user'] as const;
export type PromptVersionSource = (typeof PROMPT_VERSION_SOURCES)[number];

export const PromptComparisonQuerySchema = z.strictObject({
  window: z.enum(METRICS_WINDOWS).optional(),
});

export function parseComparisonWindow(params: URLSearchParams): MetricsWindow | { error: string } {
  const raw: Record<string, string> = {};
  for (const [key, value] of params) raw[key] = value;
  const parsed = PromptComparisonQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return { error: Object.keys(raw).some((key) => key !== 'window') ? 'Unknown query parameter.' : `window must be one of ${METRICS_WINDOWS.join(', ')}.` };
  }
  return parsed.data.window ?? DEFAULT_COMPARISON_WINDOW;
}

export const PromptResultSchema = z.object({
  versionId: z.string().nullable(),
  slug: z.string().nullable(),
  title: z.string().nullable(),
  version: z.number().nullable(),
  source: z.enum(PROMPT_VERSION_SOURCES).nullable(),
  videos: z.number(),
  medianViews: z.number().nullable(),
  lift: z.number().nullable(),
  pValue: z.number().nullable(),
  label: z.enum(COMPARISON_LABELS),
  direction: z.enum(['above', 'below']).nullable(),
});

export const AccountResultSchema = z.object({
  provider: z.string(),
  accountId: z.string(),
  videos: z.number(),
  baselineViews: z.number().nullable(),
  prompts: z.array(PromptResultSchema),
});

export const PromptComparisonResponseSchema = z.object({
  success: z.literal(true),
  window: z.enum(METRICS_WINDOWS),
  accounts: z.array(AccountResultSchema),
  truncated: z.boolean(),
});

export type PromptComparisonResponse = z.infer<typeof PromptComparisonResponseSchema>;

export const getPromptComparison = defineEndpoint({
  method: 'GET',
  path: '/api/experiments',
  query: PromptComparisonQuerySchema,
  response: PromptComparisonResponseSchema,
});
