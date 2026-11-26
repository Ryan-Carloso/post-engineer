import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { getLast24hMetrics, getPost, getPostMetrics, getYouTubeRetentionCurve, listPostsInRange } from './client-posts.js';
import { ListPostsSchema } from './schedule-shapes.js';
import {
  METRICS_FILTER_MAX_LENGTH,
  METRICS_NONE,
  METRICS_PROVIDERS,
  METRICS_WINDOWS,
  YOUTUBE_VIDEO_ID,
} from './limits.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GetPostShape = {
  id: z
    .string()
    .min(1, 'id is required')
    .describe(
      'The slot id of the post (slotId from posts (action: list), or a slot id from publish_video (action: publish_existing)).',
    ),
};

export const GetPostSchema = z.object(GetPostShape);

const metricsFilter = z.string().min(1).max(METRICS_FILTER_MAX_LENGTH);

export const GetPostMetricsShape = {
  window: z
    .enum(METRICS_WINDOWS)
    .describe(
      'Snapshot window: 24h (first day after publishing), 7d (first week) or 28d (four weeks; YouTube Analytics values are final).',
    ),
  persona: metricsFilter
    .refine((value) => value === METRICS_NONE || UUID.test(value), {
      message: `persona must be a uuid or ${METRICS_NONE}`,
    })
    .optional()
    .describe(`Optional persona id filter (uuid from personas (action: list)), or ${METRICS_NONE} for posts with no persona.`),
  account: metricsFilter
    .optional()
    .describe('Optional publishing account id filter (the account ids from accounts (action: list)).'),
  provider: z.enum(METRICS_PROVIDERS).optional().describe('Optional network filter.'),
};

export const GetPostMetricsSchema = z.object(GetPostMetricsShape);

export const GetLast24hMetricsShape = {
  persona: GetPostMetricsShape.persona,
  account: GetPostMetricsShape.account,
  provider: GetPostMetricsShape.provider,
};

export const GetLast24hMetricsSchema = z.object(GetLast24hMetricsShape);

export const GetYouTubeRetentionCurveShape = {
  account: metricsFilter.describe('The YouTube account id (channel id) the video was published on: accountId from insights (action: post_metrics) rows.'),
  video: z
    .string()
    .regex(YOUTUBE_VIDEO_ID, 'video must be a YouTube video id')
    .describe('The YouTube video id: externalId from a youtube insights (action: post_metrics) row.'),
};

export const GetYouTubeRetentionCurveSchema = z.object(GetYouTubeRetentionCurveShape);

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

export async function handleGetYouTubeRetentionCurve(
  client: PostEngineerClient,
  args: z.infer<typeof GetYouTubeRetentionCurveSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(() => getYouTubeRetentionCurve(client, args), 'getting YouTube retention curve');
}

export async function handleListPosts(client: PostEngineerClient, args: unknown): Promise<McpToolResponse> {
  const parsed = ListPostsSchema.safeParse(args);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join('; ');
    return { content: [{ type: 'text', text: `Error listing posts: ${message}` }], isError: true };
  }
  const { from, to, limit } = parsed.data;
  if (from !== undefined && to !== undefined) {
    return handleLibraryCall(() => listPostsInRange(client, { from, to }), 'listing posts');
  }
  return handleLibraryCall(() => client.listPosts(limit), 'listing posts');
}

export async function handleGetLast24hMetrics(
  client: PostEngineerClient,
  args: z.infer<typeof GetLast24hMetricsSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(() => getLast24hMetrics(client, args), 'getting last 24 hours metrics');
}
