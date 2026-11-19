import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';

export const EXPERIMENT_VARIABLES = ['hook'] as const;
export type ExperimentVariable = (typeof EXPERIMENT_VARIABLES)[number];

export const EXPERIMENT_TARGET_PAIRS_MIN = 3;
export const EXPERIMENT_TARGET_PAIRS_MAX = 20;

export const EXPERIMENT_VARIANT_COUNT = 2;

export const EXPERIMENT_NAME_MAX_LENGTH = 120;
export const EXPERIMENT_VARIANT_NAME_MAX_LENGTH = 80;
export const EXPERIMENT_VARIANT_DESCRIPTION_MAX_LENGTH = 500;

export const EXPERIMENT_VARIANT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

export const METRICS_WINDOWS = ['24h', '7d', '28d'] as const;
export type MetricsWindow = (typeof METRICS_WINDOWS)[number];

function text(max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, { message: 'must not be blank' });
}

export const CreateExperimentSchema = z
  .object({
    name: text(EXPERIMENT_NAME_MAX_LENGTH),
    variable: z.enum(EXPERIMENT_VARIABLES),
    personaId: z.string().uuid().nullable().optional(),
    targetPairs: z.number().int().min(EXPERIMENT_TARGET_PAIRS_MIN).max(EXPERIMENT_TARGET_PAIRS_MAX),
    variants: z
      .array(
        z
          .object({
            variantId: z.string().regex(EXPERIMENT_VARIANT_ID_PATTERN, 'variantId must be a lowercase slug, e.g. hook-aggressive'),
            name: text(EXPERIMENT_VARIANT_NAME_MAX_LENGTH),
            description: text(EXPERIMENT_VARIANT_DESCRIPTION_MAX_LENGTH),
          })
          .strict(),
      )
      .length(EXPERIMENT_VARIANT_COUNT)
      .refine((variants) => new Set(variants.map((variant) => variant.variantId)).size === variants.length, {
        message: 'variantId values must differ',
      }),
  })
  .strict();

export type CreateExperimentInput = z.infer<typeof CreateExperimentSchema>;

export const DEFAULT_RESULTS_WINDOW: MetricsWindow = '7d';

export function parseResultsWindow(params: URLSearchParams): MetricsWindow | { error: string } {
  const unknown = [...params.keys()].filter((key) => key !== 'window');
  if (unknown.length > 0) return { error: 'Unknown query parameter.' };
  const raw = params.get('window');
  if (raw === null) return DEFAULT_RESULTS_WINDOW;
  const match = METRICS_WINDOWS.find((window) => window === raw);
  return match ?? { error: `window must be one of ${METRICS_WINDOWS.join(', ')}.` };
}

export interface ExperimentDetailQuery {
  window: MetricsWindow;
  live: boolean;
}

export function parseExperimentDetailQuery(params: URLSearchParams): ExperimentDetailQuery | { error: string } {
  const unknown = [...params.keys()].filter((key) => key !== 'window' && key !== 'live');
  if (unknown.length > 0) return { error: 'Unknown query parameter.' };
  const rawLive = params.get('live');
  if (rawLive !== null && rawLive !== '0' && rawLive !== '1') {
    return { error: 'live must be 0 or 1.' };
  }
  const windowParams = new URLSearchParams();
  const rawWindow = params.get('window');
  if (rawWindow !== null) windowParams.set('window', rawWindow);
  const window = parseResultsWindow(windowParams);
  if (typeof window !== 'string') return window;
  return { window, live: rawLive === '1' };
}

export const ExperimentVariantViewSchema = z.object({
  variantId: z.string(),
  name: z.string(),
  description: z.string(),
});

export const ExperimentViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  variable: z.string(),
  personaId: z.string().nullable(),
  targetPairs: z.number(),
  createdAt: z.string(),
  variants: z.array(ExperimentVariantViewSchema),
});

export const CreateExperimentResponseSchema = z.object({
  success: z.boolean(),
  experiment: z.object({
    id: z.string(),
    name: z.string(),
    variable: z.string(),
    personaId: z.string().nullable(),
    targetPairs: z.number(),
    variants: z.array(ExperimentVariantViewSchema),
  }),
});

export const ListExperimentsResponseSchema = z.object({
  success: z.boolean(),
  experiments: z.array(ExperimentViewSchema),
  truncated: z.boolean(),
});

export const ExperimentVideoViewSchema = z.record(z.string(), z.unknown());

export const ExperimentResultsSchema = z.record(z.string(), z.unknown());

export const GetExperimentResultsResponseSchema = z.object({
  success: z.boolean(),
  experiment: ExperimentViewSchema,
  window: z.enum(METRICS_WINDOWS),
  videos: z.array(z.record(z.string(), z.unknown())),
  results: z.record(z.string(), z.unknown()),
  truncated: z.boolean(),
  source: z.enum(['live', 'partial', 'snapshot']).optional(),
  liveAt: z.string().nullable().optional(),
  liveFailures: z.array(z.record(z.string(), z.unknown())).optional(),
  frozen: z.boolean().optional(),
});

export const GetExperimentResultsQuerySchema = z.strictObject({
  window: z.enum(METRICS_WINDOWS).optional(),
  live: z.enum(['0', '1']).optional(),
});

export const createExperiment = defineEndpoint({
  method: 'POST',
  path: '/api/experiments',
  body: CreateExperimentSchema,
  response: CreateExperimentResponseSchema,
});

export const listExperiments = defineEndpoint({
  method: 'GET',
  path: '/api/experiments',
  response: ListExperimentsResponseSchema,
});

export const getExperimentResults = defineEndpoint({
  method: 'GET',
  path: '/api/experiments/:id',
  query: GetExperimentResultsQuerySchema,
  response: GetExperimentResultsResponseSchema,
});
