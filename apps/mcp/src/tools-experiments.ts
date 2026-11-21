import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { getPromptComparison } from './client-experiments.js';
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
