import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { cancelExperiment, createExperiment, getPromptComparison, listExperiments } from './client-experiments.js';
import type { CreateExperimentBody } from './contracts/experiments.js';
import { PERSONA_REF, withPersona } from './refs.js';
import { ScriptSegmentShape } from './single-video-shape.js';
import { METRICS_WINDOWS } from './limits.js';
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

const ExperimentVideoShape = z.object({
  title: z.string().min(1).max(100).describe('Video title.'),
  description: z.string().min(1).max(5000).describe('Publish copy for this video.'),
  segments: z.array(z.object(ScriptSegmentShape).strict()).max(12).optional().describe('The complete script as segments, written from the prompt.'),
}).strict();

export const CreateExperimentShape = {
  name: z.string().min(1).max(100).describe('Experiment name.'),
  persona: PERSONA_REF,
  videoType: z.enum(['full_lipsync', 'hook_lipsync', 'voiceover']).describe('Video type for every video of the experiment.'),
  prompts: z.array(z.object({
    promptVersionId: z.string().uuid().describe('The versionId that prompts (action: get) returned. Pinned at creation.'),
    videos: z.array(ExperimentVideoShape).describe('The scripts written from this prompt: exactly videosPerPrompt of them.'),
  }).strict()).min(2).max(5).describe('Two to five prompts to compare.'),
  videosPerPrompt: z.number().int().min(5).max(10).default(10).describe('Videos per prompt: 5 to 10 (default 10; 5 can only reach an indicative result).'),
  postsPerDay: z.number().int().min(1).max(5).describe('Posts per day on the accounts: 1 to 5.'),
  providers: z.array(z.string()).min(1).max(20).describe('Networks to publish to.'),
  accounts: z.record(z.string(), z.array(z.string())).optional().describe('Account ids per network. Omit to use the persona bound accounts.'),
  startAt: z.string().min(1).describe('First publishing day, local to timezone.'),
  times: z.array(z.string()).min(1).max(5).describe('Publishing times (HH:MM): exactly postsPerDay of them.'),
  timezone: z.string().min(1).max(100).describe('IANA timezone for startAt and times.'),
};

export const CreateExperimentSchema = z.object(CreateExperimentShape);

export async function handleCreateExperiment(
  client: PostEngineerClient,
  args: z.infer<typeof CreateExperimentSchema>,
): Promise<McpToolResponse> {
  return withPersona(client, args, async (resolved) => handleLibraryCall(() => createExperiment(client, resolved as CreateExperimentBody), 'creating experiment'));
}

export const ListExperimentsShape = {};
export const ListExperimentsSchema = z.object(ListExperimentsShape);

export async function handleListExperiments(client: PostEngineerClient): Promise<McpToolResponse> {
  return handleLibraryCall(() => listExperiments(client), 'listing experiments');
}

export const CancelExperimentShape = {
  experimentId: z.string().uuid().describe('The experiment id returned by create.'),
};
export const CancelExperimentSchema = z.object(CancelExperimentShape);

export async function handleCancelExperiment(
  client: PostEngineerClient,
  args: z.infer<typeof CancelExperimentSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(() => cancelExperiment(client, args.experimentId), 'cancelling experiment');
}
