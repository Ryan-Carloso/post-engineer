import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { createExperiment, getPromptComparison } from './client-experiments.js';
import { CreateExperimentBodySchema } from './contracts/experiments.js';
import { METRICS_WINDOWS } from './limits.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';

export const PromptComparisonShape = {
  window: z.enum(METRICS_WINDOWS).optional(),
};
export const PromptComparisonSchema = z.object(PromptComparisonShape);

export async function handlePromptComparison(
  client: PostEngineerClient,
  args: z.infer<typeof PromptComparisonSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(() => getPromptComparison(client, args.window), 'comparing prompts');
}

const jsonObject = z.record(z.string(), z.unknown());

export const CreateExperimentShape = {
  personaId: z.string().optional(),
  account: jsonObject.describe('{ provider, accountId }'),
  videoType: z.string(),
  options: jsonObject.optional(),
  startAt: z.string(),
  times: z.array(z.string()).describe('1-5 "HH:MM"'),
  timezone: z.string(),
  variants: z.array(jsonObject).describe('2-4 { versionId, videos }'),
  quoteKey: z.string().optional(),
  expiresAt: z.string().optional(),
};
export const CreateExperimentSchema = z.object(CreateExperimentShape);
export type CreateExperimentArgs = z.infer<typeof CreateExperimentSchema>;

const QUOTE_NEXT =
  'Quote only: nothing was charged or scheduled. Show the user the plan, total tokens and warnings. To create it, call experiments (action: create) again with the same arguments plus this quoteKey and expiresAt; ask for a new quote when it expires or anything changes';

const CONFIRMED_NEXT =
  'Experiment created. Keep the scheduleId: schedules (action: cancel) cancels videos that have not posted. Read experiments (action: results) once the posts have views';

export async function handleCreateExperiment(client: PostEngineerClient, args: CreateExperimentArgs): Promise<McpToolResponse> {
  const parsed = CreateExperimentBodySchema.safeParse(args);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(input)'}: ${issue.message}`).join('; ');
    return { content: [{ type: 'text', text: `Error in experiments · create: ${problems}` }], isError: true };
  }
  return handleLibraryCall(
    () => createExperiment(client, parsed.data),
    'creating experiment',
    (result) => (result.stage === 'quote' ? QUOTE_NEXT : CONFIRMED_NEXT),
  );
}
