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
import { GeneratePersonaVideoShape, ScriptSegmentShape } from './single-video-shape.js';
import { handleGeneratePersonaVideo } from './tools-single-video.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';

//---------------
// Paired A/B content experiments (issue #476): create_experiment,
// list_experiments, add_experiment_pair and get_experiment_results.
//
// An experiment tests ONE variable (the hook) with two variants. It is a
// set of pairs: inside a pair both videos share topic, body and CTA and only
// the hook differs; across pairs the topic changes. add_experiment_pair
// creates both videos of one pair through generate-and-schedule (two normal
// charged videos) and the server rejects a pair that differs in anything
// but the hook, before charging.
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

const { segments: _segments, title: _title, idempotencyKey: _key, recipe: _recipe, experiment: _experiment, ...deliveryShape } =
  GeneratePersonaVideoShape;

export const AddExperimentPairShape = {
  experimentId: z.string().uuid().describe('Experiment id from create_experiment.'),
  pair: z.number().int().min(1).max(EXPERIMENT_TARGET_PAIRS_MAX).describe('Pair number: 1 for the first pair, then 2, 3... up to targetPairs.'),
  title: z.string().min(1).describe('Slot label for both videos (the pair topic).'),
  segments: z
    .array(z.object(ScriptSegmentShape).strict())
    .min(2)
    .max(11)
    .refine((list) => list.every((segment) => segment.kind !== 'hook'), { message: 'segments must not contain the hook: put each variant\'s hook in hooks' })
    .describe('The shared script WITHOUT the hook: body segments, then the CTA. Identical for both videos of the pair.'),
  hooks: z
    .array(
      z
        .object({
          variantId,
          text: ScriptSegmentShape.text.describe('This variant\'s hook, written following the variant description (15-40 words, ending with terminal punctuation).'),
          media: ScriptSegmentShape.media,
        })
        .strict(),
    )
    .length(2)
    .refine((list) => list[0].variantId !== list[1].variantId, { message: 'hooks must cover both variants' })
    .refine((list) => list[0].text.trim() !== list[1].text.trim(), { message: 'the two hooks must differ' })
    .describe('One hook per variant. Only the hook differs inside a pair.'),
  spacingHours: z
    .number()
    .int()
    .min(1)
    .max(72)
    .default(24)
    .describe('Scheduled mode: the second video starts this many hours after the first (default 24 = next day, same time). Ignored in asap mode.'),
  ...deliveryShape,
};
export const AddExperimentPairSchema = z.object(AddExperimentPairShape);

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
    'Experiment created. Next: add_experiment_pair for pair 1, 2, ... (each pair = 2 charged videos)',
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

/** Shift a startAt by hours, keeping it naive (wall clock) when it was naive. */
export function shiftStartAt(startAt: string, hours: number): string {
  const absolute = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(startAt);
  const ms = Date.parse(absolute ? startAt : `${startAt}Z`) + hours * 3_600_000;
  const shifted = new Date(ms).toISOString();
  return absolute ? shifted : shifted.replace(/\.\d{3}Z$/, '');
}

function textOf(response: McpToolResponse): string {
  return response.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');
}

export async function handleAddExperimentPair(
  client: PostEngineerClient,
  args: z.infer<typeof AddExperimentPairSchema>,
): Promise<McpToolResponse> {
  const { experimentId, pair, title, segments, hooks, spacingHours, ...delivery } = args;
  // Alternate which variant goes first (A,B / B,A) so publish order never
  // favours one variant.
  const ordered = pair % 2 === 1 ? hooks : [hooks[1], hooks[0]];
  const parts: string[] = [];
  for (const [index, hook] of ordered.entries()) {
    const startAt =
      index === 1 && delivery.mode !== 'asap' && delivery.startAt !== undefined
        ? shiftStartAt(delivery.startAt, spacingHours)
        : delivery.startAt;
    const response = await handleGeneratePersonaVideo(client, {
      ...delivery,
      startAt,
      title,
      segments: [{ kind: 'hook', text: hook.text, ...(hook.media === undefined ? {} : { media: hook.media }) }, ...segments],
      // Deterministic per (experiment, pair, variant): calling this tool
      // again replays the videos already created instead of charging twice.
      idempotencyKey: `exp-${experimentId}-p${pair}-${hook.variantId}`,
      experiment: { experimentId, variantId: hook.variantId, pair },
    });
    if (response.isError === true) {
      const done = index === 1 ? ` The ${ordered[0].variantId} video of pair ${pair} was created; call add_experiment_pair again with the same arguments after fixing the error — it replays that video and only creates the missing one.` : '';
      return { content: [{ type: 'text', text: `Pair ${pair}, variant ${hook.variantId}: ${textOf(response)}${done}` }], isError: true };
    }
    parts.push(`Variant ${hook.variantId}:\n${textOf(response)}`);
  }
  return { content: [{ type: 'text', text: `Pair ${pair} of experiment ${experimentId} created (2 videos).\n\n${parts.join('\n\n')}` }] };
}
