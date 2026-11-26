import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { actionDescription, actionShape, byAction } from './action-tool.js';
import type { PostEngineerClient } from './client.js';
import { DESTRUCTIVE, READ_ONLY } from './tool-annotations.js';
import { POINTER_POSTS_SCHEDULES } from './server-instructions.js';
import {
  CreateShareLinkShape,
  ListShareLinksShape,
  RevokeShareLinkShape,
  handleCreateShareLink,
  handleListShareLinks,
  handleRevokeShareLink,
} from './tools-share-links.js';
import {
  CancelScheduleShape,
  DeleteSlotShape,
  GetSlotShape,
  ListPostsShape,
  ListSchedulesShape,
  UpdateSlotTitleShape,
  handleCancelSchedule,
  handleDeleteSlot,
  handleGetSlot,
  handleListSchedules,
  handleUpdateSlotTitle,
} from './tools.js';
import {
  GetLast24hMetricsShape,
  GetPostMetricsShape,
  GetPostShape,
  GetYouTubeRetentionCurveShape,
  handleGetPost,
  handleGetLast24hMetrics,
  handleGetPostMetrics,
  handleGetYouTubeRetentionCurve,
  handleListPosts,
} from './tools-posts.js';

const SCHEDULES_SPECS = {
  list: ListSchedulesShape,
  cancel: CancelScheduleShape,
  get_slot: GetSlotShape,
  update_slot_title: UpdateSlotTitleShape,
  delete_slot: DeleteSlotShape,
};

const POSTS_SPECS = { list: ListPostsShape, get: GetPostShape };

const INSIGHTS_SPECS = {
  post_metrics: GetPostMetricsShape,
  last_day: GetLast24hMetricsShape,
  retention_curve: GetYouTubeRetentionCurveShape,
  share_link_create: CreateShareLinkShape,
  share_link_list: ListShareLinksShape,
  share_link_revoke: RevokeShareLinkShape,
};

export function registerLibraryTools(server: McpServer, client: PostEngineerClient): void {
  server.tool(
    'schedules',
    actionDescription(
      `Your scheduled posts (future slots). list: the schedules. get_slot / update_slot_title / delete_slot: one slot of a schedule. cancel: cancels a whole schedule: unpublished slots are removed; a post already publishing or published is not recalled. ${POINTER_POSTS_SCHEDULES}`,
      SCHEDULES_SPECS,
    ),
    actionShape(SCHEDULES_SPECS),
    DESTRUCTIVE,
    byAction(
      {
        list: async () => handleListSchedules(client),
        cancel: async (args) => handleCancelSchedule(client, args),
        get_slot: async (args) => handleGetSlot(client, args),
        update_slot_title: async (args) => handleUpdateSlotTitle(client, args),
        delete_slot: async (args) => handleDeleteSlot(client, args),
      },
      SCHEDULES_SPECS,
      'schedules',
    ),
  );

  server.tool(
    'posts',
    actionDescription(`Your published and scheduled posts. list: the recent posts with their status and links. get: one post by slot id, with its publish results. ${POINTER_POSTS_SCHEDULES}`, POSTS_SPECS),
    actionShape(POSTS_SPECS),
    READ_ONLY,
    byAction(
      {
        list: async (args) => handleListPosts(client, args),
        get: async (args) => handleGetPost(client, args),
      },
      POSTS_SPECS,
      'posts',
    ),
  );

  server.tool(
    'insights',
    actionDescription('How your posts performed. post_metrics: per-network metrics of published posts (views, likes, comments, average view duration, published date), filterable by persona, network, account and window. last_day: the views and engagement each video gained in the last 24 hours (the difference between two daily readings, not a lifetime total), with totals, filterable by persona, network and account; a video published less than 24 hours ago counts everything since publishing, a video with no reading from about a day earlier lands in skipped.noBaseline, and a counter that went backwards counts as 0 (counterResets). retention_curve: the YouTube audience retention curve of one post. share_link_create: a public read-only link (no login) to the metrics summary of the first 7 days and this week\'s posts, optionally limited to one persona and an expiry; the url is returned once and only its hash is stored. share_link_list: your links with their scope, expiry, revocation and last view, never the url. share_link_revoke: stops a link at once.', INSIGHTS_SPECS),
    actionShape(INSIGHTS_SPECS),
    DESTRUCTIVE,
    byAction(
      {
        post_metrics: async (args) => handleGetPostMetrics(client, args),
        last_day: async (args) => handleGetLast24hMetrics(client, args),
        retention_curve: async (args) => handleGetYouTubeRetentionCurve(client, args),
        share_link_create: (args) => handleCreateShareLink(client, args),
        share_link_list: async () => handleListShareLinks(client),
        share_link_revoke: async (args) => handleRevokeShareLink(client, args),
      },
      INSIGHTS_SPECS,
      'insights',
    ),
  );
}
