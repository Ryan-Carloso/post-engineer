import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { actionDescription, actionShape, byAction } from './action-tool.js';
import type { PostEngineerClient } from './client.js';
import { withRecipeNudge, type RecipeSession } from './recipe-session.js';
import { DESTRUCTIVE, READ_ONLY } from './tool-annotations.js';
import {
  CancelScheduleShape,
  DeleteSlotShape,
  GetSlotShape,
  ListPostsShape,
  ListSchedulesShape,
  ListTokenTransactionsShape,
  UpdateSlotTitleShape,
  handleCancelSchedule,
  handleDeleteSlot,
  handleGetSlot,
  handleListSchedules,
  handleListTokenTransactions,
  handleUpdateSlotTitle,
  handleGetTokenBalance,
} from './tools.js';
import {
  GetPostMetricsShape,
  GetPostShape,
  GetYouTubeRetentionCurveShape,
  handleGetPost,
  handleGetPostMetrics,
  handleGetYouTubeRetentionCurve,
  handleListPosts,
} from './tools-posts.js';

//---------------
// schedules, posts, insights and billing (issue #566): what you have
// scheduled, what was published, how it performed, and what it cost.
//---------------

const SCHEDULES_SPECS = {
  list: ListSchedulesShape,
  cancel: CancelScheduleShape,
  get_slot: GetSlotShape,
  update_slot_title: UpdateSlotTitleShape,
  delete_slot: DeleteSlotShape,
};

const POSTS_SPECS = { list: ListPostsShape, get: GetPostShape };

const INSIGHTS_SPECS = { post_metrics: GetPostMetricsShape, retention_curve: GetYouTubeRetentionCurveShape };

const BILLING_SPECS = { balance: {}, transactions: ListTokenTransactionsShape };

export function registerLibraryTools(server: McpServer, client: PostEngineerClient, session: RecipeSession): void {
  server.tool(
    'schedules',
    actionDescription(
      'Your scheduled videos (future slots). list: the schedules. get_slot / update_slot_title / delete_slot: one slot of a schedule. cancel: cancels a whole schedule: unpublished slots are removed, but only slots whose generation never ran get their prepaid tokens back (a generating or ready slot keeps its charge, the GPU cost is spent); a post already publishing or published is not recalled; a cancelled video of a discounted batch gives back the discount the batch no longer earns.',
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
    actionDescription('Your published and scheduled posts. list: the recent posts with their status and links. get: one post by slot id or generation id, with its publish results.', POSTS_SPECS),
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
    actionDescription('How your posts performed. post_metrics: per-network metrics of published posts (views, likes, comments, average view duration), filterable by persona, network, account and window. retention_curve: the YouTube audience retention curve of one post.', INSIGHTS_SPECS),
    actionShape(INSIGHTS_SPECS),
    READ_ONLY,
    byAction(
      {
        post_metrics: async (args) => handleGetPostMetrics(client, args),
        retention_curve: async (args) => handleGetYouTubeRetentionCurve(client, args),
      },
      INSIGHTS_SPECS,
      'insights',
    ),
  );

  server.tool(
    'billing',
    actionDescription('Your prepaid tokens. balance: the current balance. transactions: the ledger of spends and credits, newest first.', BILLING_SPECS),
    actionShape(BILLING_SPECS),
    READ_ONLY,
    byAction(
      {
        balance: withRecipeNudge(session, 'billing_balance', async () => handleGetTokenBalance(client)),
        transactions: async (args) => handleListTokenTransactions(client, args),
      },
      BILLING_SPECS,
      'billing',
    ),
  );
}
