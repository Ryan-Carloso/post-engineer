import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';
import { METRICS_WINDOWS, type MetricsWindow } from './metrics.js';
import { segmentsRequestSchema } from './videos.js';

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

export const MIN_VIDEOS_PER_PROMPT = 5;
export const DEFAULT_VIDEOS_PER_PROMPT = 10;
export const MAX_VIDEOS_PER_PROMPT = 10;
export const MIN_PROMPTS_PER_EXPERIMENT = 2;
export const MAX_PROMPTS_PER_EXPERIMENT = 5;
export const MAX_EXPERIMENT_VIDEOS = MAX_PROMPTS_PER_EXPERIMENT * MAX_VIDEOS_PER_PROMPT;
export const MIN_POSTS_PER_DAY = 1;
export const MAX_POSTS_PER_DAY = 5;

export const ExperimentVideoSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().min(1).max(5000),
  segments: segmentsRequestSchema.optional(),
});

export const CreateExperimentBodySchema = z.strictObject({
  name: z.string().min(1).max(100),
  personaId: z.string().uuid(),
  videoType: z.enum(['full_lipsync', 'hook_lipsync', 'voiceover']),
  prompts: z.array(z.strictObject({
    promptVersionId: z.string().uuid(),
    videos: z.array(ExperimentVideoSchema),
  })).min(MIN_PROMPTS_PER_EXPERIMENT).max(MAX_PROMPTS_PER_EXPERIMENT),
  videosPerPrompt: z.number().int().min(MIN_VIDEOS_PER_PROMPT).max(MAX_VIDEOS_PER_PROMPT).default(DEFAULT_VIDEOS_PER_PROMPT),
  postsPerDay: z.number().int().min(MIN_POSTS_PER_DAY).max(MAX_POSTS_PER_DAY),
  providers: z.array(z.string()).min(1).max(20),
  accounts: z.record(z.string(), z.array(z.string())).optional(),
  startAt: z.string().min(1),
  times: z.array(z.string()).min(1).max(MAX_POSTS_PER_DAY),
  timezone: z.string().min(1).max(100),
});

export type CreateExperimentBody = z.infer<typeof CreateExperimentBodySchema>;

export const CreateExperimentResponseSchema = z.object({
  success: z.literal(true),
  experimentId: z.string(),
  scheduleIds: z.array(z.string()),
  slots: z.array(z.object({ slotId: z.string(), slotAt: z.string(), promptVersionId: z.string(), title: z.string() })),
  totalVideos: z.number(),
  totalTokens: z.number(),
  endAt: z.string(),
});

export const ExperimentProgressSchema = z.object({
  id: z.string(),
  name: z.string(),
  personaId: z.string(),
  promptVersionIds: z.array(z.string()),
  videosPerPrompt: z.number(),
  postsPerDay: z.number(),
  videoType: z.string(),
  status: z.enum(['active', 'cancelled']),
  createdAt: z.string(),
  progress: z.array(z.object({ promptVersionId: z.string(), total: z.number(), published: z.number(), pending: z.number() })),
});

export type CreateExperimentResponse = z.infer<typeof CreateExperimentResponseSchema>;
export type ExperimentProgress = z.infer<typeof ExperimentProgressSchema>;

export const ListExperimentsResponseSchema = z.object({
  success: z.literal(true),
  experiments: z.array(ExperimentProgressSchema),
});

export const createExperiment = defineEndpoint({
  method: 'POST',
  path: '/api/experiments',
  body: CreateExperimentBodySchema,
  response: CreateExperimentResponseSchema,
});

export const listExperiments = defineEndpoint({
  method: 'GET',
  path: '/api/experiments/instances',
  response: ListExperimentsResponseSchema,
});

export const cancelExperiment = defineEndpoint({
  method: 'DELETE',
  path: '/api/experiments/instances',
  response: z.object({ success: z.literal(true), cancelledSlotIds: z.array(z.string()), refundedTokens: z.number() }),
});
