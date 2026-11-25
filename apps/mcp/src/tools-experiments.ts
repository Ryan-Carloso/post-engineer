import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { createExperiment, getPromptComparison } from './client-experiments.js';
import { CreateExperimentBodySchema } from './contracts/experiments.js';
import { METRICS_WINDOWS } from './limits.js';
import { optionalPersonaRefShape, resolveAccountRef, withOptionalPersona } from './refs.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';

export const PromptComparisonShape = {
  window: z.enum(METRICS_WINDOWS).optional().describe('Metrics window to compare: 24h, 7d (default) or 28d.'),
};
export const PromptComparisonSchema = z.object(PromptComparisonShape);

export async function handlePromptComparison(
  client: PostEngineerClient,
  args: z.infer<typeof PromptComparisonSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(() => getPromptComparison(client, args.window), 'comparing prompts');
}

const jsonObject = z.record(z.string(), z.unknown());

export const CreateExperimentShape = optionalPersonaRefShape({
  account: jsonObject.describe('{ provider, accountId }: accountId is the account name or id (accounts (action: list) shows both)'),
  videoType: z.string(),
  options: jsonObject.optional(),
  startAt: z.string(),
  times: z.array(z.string()).describe('1-5 "HH:MM"'),
  timezone: z.string(),
  variants: z.array(jsonObject).describe('2-4 { versionId, videos }'),
  quoteKey: z.string().optional(),
  expiresAt: z.string().optional(),
});
export const CreateExperimentSchema = z.object(CreateExperimentShape);
export type CreateExperimentInput = z.infer<typeof CreateExperimentSchema>;
export type CreateExperimentArgs = Omit<CreateExperimentInput, 'persona'> & { personaId?: string };

export async function withExperimentRefs(
  client: PostEngineerClient,
  args: CreateExperimentInput,
  run: (resolved: CreateExperimentArgs) => Promise<McpToolResponse>,
): Promise<McpToolResponse> {
  return withOptionalPersona(client, args, async (resolved) => {
    const { provider, accountId } = resolved.account;
    if (typeof provider !== 'string' || typeof accountId !== 'string') return run(resolved);
    const outcome = await resolveAccountRef(client, accountId, provider);
    if (outcome.kind === 'response') return outcome.response;
    return run({ ...resolved, account: { ...resolved.account, accountId: outcome.value.id } });
  });
}

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
