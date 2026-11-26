import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';
import { METRICS_WINDOWS, type MetricsWindow } from './metrics.js';
import { VIDEO_TYPES, VideoOptionsObjectSchema, segmentsRequestSchema } from './videos.js';

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

export const EXPERIMENT_MIN_VARIANTS = 2;
export const EXPERIMENT_MAX_VARIANTS = 4;
export const EXPERIMENT_MIN_VIDEOS_PER_VARIANT = 5;
export const EXPERIMENT_DEFAULT_VIDEOS_PER_VARIANT = 10;
export const EXPERIMENT_MAX_VIDEOS_PER_VARIANT = 15;
export const EXPERIMENT_MAX_TOTAL_VIDEOS = 40;
export const EXPERIMENT_MAX_FULL_LIPSYNC_VIDEOS = 20;
export const EXPERIMENT_MAX_TIMES_PER_DAY = 5;
export const EXPERIMENT_QUOTE_KEY_PATTERN = /^[0-9a-f]{64}$/;

const ExperimentVideoSchema = z.strictObject({
  title: z.string().max(100, 'title must be at most 100 characters.'),
  description: z.string().min(1, 'description must be a non-empty string: the publish copy for this video.').max(5000, 'description must be at most 5000 characters.'),
  segments: segmentsRequestSchema,
});

const ExperimentVariantSchema = z.strictObject({
  versionId: z.string().uuid('versionId must be the versionId returned with a prompt you can read.'),
  videos: z.array(ExperimentVideoSchema).min(EXPERIMENT_MIN_VIDEOS_PER_VARIANT).max(EXPERIMENT_MAX_VIDEOS_PER_VARIANT),
});

const ExperimentOptionsSchema = z.strictObject(VideoOptionsObjectSchema.omit({ videoType: true, segments: true }).shape);

export const CreateExperimentBodySchema = z
  .strictObject({
    personaId: z.string().optional(),
    account: z.strictObject({
      provider: z.string().min(1),
      accountId: z.string().min(1),
    }),
    videoType: z.enum(VIDEO_TYPES),
    options: ExperimentOptionsSchema.optional(),
    startAt: z.string(),
    times: z.array(z.string()).min(1).max(EXPERIMENT_MAX_TIMES_PER_DAY),
    timezone: z.string(),
    variants: z.array(ExperimentVariantSchema).min(EXPERIMENT_MIN_VARIANTS).max(EXPERIMENT_MAX_VARIANTS),
    quoteKey: z.string().regex(EXPERIMENT_QUOTE_KEY_PATTERN, 'quoteKey must be the quoteKey returned by the quote call.').optional(),
    expiresAt: z.string().optional(),
  })
  .refine((body) => (body.quoteKey === undefined) === (body.expiresAt === undefined), {
    message: 'quoteKey and expiresAt come together from the quote call: send both to confirm, or neither to get a quote.',
    path: ['quoteKey'],
  });

export type CreateExperimentBody = z.infer<typeof CreateExperimentBodySchema>;

const ExperimentWarningSchema = z.object({ code: z.string() }).passthrough();

export const ExperimentQuoteResponseSchema = z.object({
  success: z.literal(true),
  stage: z.literal('quote'),
  quoteKey: z.string(),
  expiresAt: z.string(),
  perVideoTokens: z.number(),
  totalTokens: z.number(),
  videos: z.number(),
  slots: z.array(
    z.object({
      slotAt: z.string(),
      versionId: z.string(),
      title: z.string(),
    }),
  ),
  warnings: z.array(ExperimentWarningSchema),
});

export const ExperimentCreatedResponseSchema = z.object({
  success: z.literal(true),
  stage: z.literal('confirmed'),
  scheduleId: z.string(),
  replayed: z.boolean(),
  chargedTokens: z.number(),
  slots: z.array(
    z.object({
      slotId: z.string(),
      slotAt: z.string(),
      title: z.string(),
      versionId: z.string().nullable(),
      taskId: z.string().nullable(),
      status: z.string(),
      errorCode: z.string().optional(),
      reason: z.string().optional(),
      tokensRefunded: z.boolean().optional(),
    }),
  ),
  warnings: z.array(ExperimentWarningSchema),
});

export const CreateExperimentResponseSchema = z.discriminatedUnion('stage', [
  ExperimentQuoteResponseSchema,
  ExperimentCreatedResponseSchema,
]);

export const createExperiment = defineEndpoint({
  method: 'POST',
  path: '/api/experiments',
  body: CreateExperimentBodySchema,
  response: CreateExperimentResponseSchema,
});
