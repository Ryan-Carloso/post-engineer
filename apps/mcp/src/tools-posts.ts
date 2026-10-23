import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { getPost, getPostMetrics } from './client-posts.js';
import {
  METRICS_FILTER_MAX_LENGTH,
  METRICS_NONE,
  METRICS_PROVIDERS,
  METRICS_WINDOWS,
} from './limits.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';

//---------------
// get_post and get_post_metrics — MCP tools.
//
// Extracted from tools.ts so the tools module stays under the file-size
// ratchet.
//---------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GetPostShape = {
  id: z
    .string()
    .min(1, 'id is required')
    .describe(
      'A post id of either kind: a slot id (slotId from list_posts / generate_persona_videos) or a generation id (generationId from list_video_generations). The server resolves which one it is.',
    ),
};

export const GetPostSchema = z.object(GetPostShape);

const metricsFilter = z.string().min(1).max(METRICS_FILTER_MAX_LENGTH);

export const GetPostMetricsShape = {
  window: z
    .enum(METRICS_WINDOWS)
    .describe('Snapshot window: 24h (first day after publishing) or 7d (first week).'),
  persona: metricsFilter
    .refine((value) => value === METRICS_NONE || UUID.test(value), {
      message: `persona must be a uuid or ${METRICS_NONE}`,
    })
    .optional()
    .describe(`Optional persona id filter (uuid from list_personas), or ${METRICS_NONE} for posts with no persona.`),
  account: metricsFilter
    .optional()
    .describe('Optional publishing account id filter (the account ids from list_social_accounts).'),
  provider: z.enum(METRICS_PROVIDERS).optional().describe('Optional network filter.'),
  angle: metricsFilter
    .optional()
    .describe(`Optional script angle filter (exact match), or ${METRICS_NONE} for posts with no angle.`),
};

export const GetPostMetricsSchema = z.object(GetPostMetricsShape);

export async function handleGetPost(
  client: PostEngineerClient,
  args: z.infer<typeof GetPostSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(() => getPost(client, args.id), 'getting post');
}

export async function handleGetPostMetrics(
  client: PostEngineerClient,
  args: z.infer<typeof GetPostMetricsSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(() => getPostMetrics(client, args), 'getting post metrics');
}
