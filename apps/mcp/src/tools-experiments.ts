import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { createExperiment, getExperimentResults, listExperiments } from './client-experiments.js';
import {
  EXPERIMENT_NAME_MAX_LENGTH,
  EXPERIMENT_TARGET_PAIRS_MAX,
  EXPERIMENT_TARGET_PAIRS_MIN,
  EXPERIMENT_VARIANT_DESCRIPTION_MAX_LENGTH,
  EXPERIMENT_VARIANT_ID_PATTERN,
  EXPERIMENT_VARIANT_NAME_MAX_LENGTH,
  METRICS_WINDOWS,
} from './limits.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';

//---------------
// Paired A/B content experiments (issue #476): create_experiment,
// list_experiments and get_experiment_results.
//
// An experiment tests ONE variable (the hook) with two variants. It is a
// set of pairs: inside a pair both videos share topic, body and CTA and only
// the hook differs; across pairs the topic changes.
//---------------

const variantId = z
  .string()
  .regex(EXPERIMENT_VARIANT_ID_PATTERN, 'variantId must be a lowercase slug such as hook-aggressive (never "A"/"B")');

export const CreateExperimentShape = {
  name: z.string().min(1).max(EXPERIMENT_NAME_MAX_LENGTH).describe('Experiment name, e.g. "Calm vs aggressive hook".'),
  personaId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe('Persona every video of the experiment uses. Null or omitted = faceless experiment with no persona.'),
  targetPairs: z
    .number()
    .int()
    .min(EXPERIMENT_TARGET_PAIRS_MIN)
    .max(EXPERIMENT_TARGET_PAIRS_MAX)
    .default(6)
    .describe('Pairs to publish (each pair = 2 charged videos). The result can only be "clear" once all pairs are in; with 6 pairs one variant must win all 6, a moderate effect needs about 10-12.'),
  variants: z
    .array(
      z
        .object({
          variantId: variantId.describe('Slug that identifies the variant in results and PostHog, e.g. hook-aggressive.'),
          name: z.string().min(1).max(EXPERIMENT_VARIANT_NAME_MAX_LENGTH).describe('Human name, e.g. "Aggressive hook".'),
          description: z
            .string()
            .min(1)
            .max(EXPERIMENT_VARIANT_DESCRIPTION_MAX_LENGTH)
            .describe('The style rule you will follow when writing this variant\'s hooks, e.g. "direct, provocative, calls out a mistake".'),
        })
        .strict(),
    )
    .length(2)
    .refine((variants) => new Set(variants.map((variant) => variant.variantId)).size === variants.length, {
      message: 'variantId values must differ',
    })
    .describe('Exactly two variants of the hook.'),
};
export const CreateExperimentSchema = z.object(CreateExperimentShape);

export const ListExperimentsShape = {};

export const GetExperimentResultsShape = {
  experimentId: z.string().uuid().describe('Experiment id from create_experiment / list_experiments.'),
  window: z.enum(METRICS_WINDOWS).optional().describe('Metrics window to compare: 24h, 7d (default) or 28d.'),
};
export const GetExperimentResultsSchema = z.object(GetExperimentResultsShape);


export async function handleCreateExperiment(
  client: PostEngineerClient,
  args: z.infer<typeof CreateExperimentSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(
    () =>
      createExperiment(client, {
        name: args.name,
        variable: 'hook',
        personaId: args.personaId ?? null,
        targetPairs: args.targetPairs,
        variants: args.variants,
      }),
    'creating experiment',
    'Experiment created',
  );
}

export async function handleListExperiments(client: PostEngineerClient): Promise<McpToolResponse> {
  return handleLibraryCall(() => listExperiments(client), 'listing experiments');
}

export async function handleGetExperimentResults(
  client: PostEngineerClient,
  args: z.infer<typeof GetExperimentResultsSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(() => getExperimentResults(client, args.experimentId, args.window), 'getting experiment results');
}
