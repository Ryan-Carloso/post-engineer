#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PostEngineerClient, MAX_LIBRARY_IMAGES, MAX_LIBRARY_IMAGE_MB } from './client.js';
import {
  CreatePersonaShape,
  ListPersonasShape,
  ListVoicesShape,
  ListFacesShape,
  UpdatePersonaShape,
  ListSocialAccountsShape,
  ConnectAccountShape,
  ListSchedulesShape,
  GetTokenBalanceShape,
  ListPostsShape,
  CancelScheduleShape,
  GeneratePersonaVideosShape,
  GetVideoStatusShape,
  GetVideoTaskProgressShape,
  ListPersonaImagesShape,
  AddPersonaImageShape,
  UpdatePersonaImageShape,
  RemovePersonaImageShape,
  handleCreatePersona,
  handleListPersonas,
  handleListVoices,
  handleListFaces,
  handleUpdatePersona,
  handleListSocialAccounts,
  handleConnectAccount,
  handleListSchedules,
  handleListPosts,
  handleCancelSchedule,
  handleGetTokenBalance,
  handleGeneratePersonaVideos,
  handleGetVideoStatus,
  handleGetVideoTaskProgress,
  handleListPersonaImages,
  handleAddPersonaImage,
  handleUpdatePersonaImage,
  handleRemovePersonaImage,
} from './tools.js';
import { trackEvent } from './analytics.js';

//---------------
// Track every tool invocation as a PostHog analytics event.
// The wrapper never throws and never blocks the tool.
//---------------

function withTracking<TArgs extends Record<string, unknown>, TResult>(
  toolName: string,
  handler: (args: TArgs) => Promise<TResult>,
): (args: TArgs) => Promise<TResult> {
  return async (args: TArgs): Promise<TResult> => {
    trackEvent('mcp_tool_called', { toolName });
    return handler(args);
  };
}

// The server advertises the package version: import it so a version bump in
// package.json flows through without touching this file.
const { default: pkg } = await import('../package.json', { with: { type: 'json' } });

export function requireApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const apiKey = env.POST_ENGINEER_API_KEY;
  if (!apiKey) {
    throw new Error('POST_ENGINEER_API_KEY is required');
  }
  return apiKey;
}

export function createPostEngineerMcpServer(client?: PostEngineerClient): McpServer {
  const apiClient = client ?? new PostEngineerClient({ apiKey: requireApiKey() });
  const server = new McpServer({
    name: 'post-engineer-mcp',
    version: pkg.version,
  });

  server.tool(
    'create_persona',
    'Create a new AI persona with avatar, voice, language, and niche prompt.',
    CreatePersonaShape,
    withTracking('create_persona', async (args) => {
      return handleCreatePersona(apiClient, args);
    })
  );

  server.tool(
    'list_personas',
    'List all existing personas for the authenticated user.',
    ListPersonasShape,
    withTracking('list_personas', async () => {
      return handleListPersonas(apiClient);
    })
  );

  server.tool(
    'list_voices',
    'List all available persona voices (voiceId options) for the authenticated user.',
    ListVoicesShape,
    withTracking('list_voices', async () => {
      return handleListVoices(apiClient);
    })
  );

  server.tool(
    'list_faces',
    'List default/stock persona faces (avatar options). Each face includes id, url, name, gender, age (single number, not a range), ethnicity, hair, and description in English so you can pick without seeing the photo. Pass a face url as avatarUrl when calling create_persona.',
    ListFacesShape,
    withTracking('list_faces', async () => {
      return handleListFaces(apiClient);
    })
  );

  server.tool(
    'update_persona',
    'Update an existing AI persona (only the provided fields change).',
    UpdatePersonaShape,
    withTracking('update_persona', async (args) => {
      return handleUpdatePersona(apiClient, args);
    })
  );

  server.tool(
    'list_social_accounts',
    'List connected social accounts (YouTube, Instagram, LinkedIn, Bluesky) with the account IDs needed for batch posting.',
    ListSocialAccountsShape,
    withTracking('list_social_accounts', async () => {
      return handleListSocialAccounts(apiClient);
    })
  );

  server.tool(
    'connect_account',
    'Connect a social account. For youtube/instagram/linkedin: returns an authorization URL — the user must open it in a browser and authorize, then the account connects automatically (verify with list_social_accounts). For bluesky: connects directly with handle + appPassword (app password, not the main account password).',
    ConnectAccountShape,
    withTracking('connect_account', async (args) => {
      return handleConnectAccount(apiClient, args);
    })
  );

  server.tool(
    'list_schedules',
    'List all automation schedules for the authenticated user.',
    ListSchedulesShape,
    withTracking('list_schedules', async () => {
      return handleListSchedules(apiClient);
    })
  );

  server.tool(
    'list_posts',
    'List upcoming (scheduled) and past (published/failed) posts across all connected accounts. Returns two lists: upcoming slots and recent results, each with id, slot_at, status (awaiting|generating|ready|publishing|published|failed), topic, schedule_id, task_id, progress (0-100: 0 for awaiting, 100 for ready/publishing/published, live engine progress for generating, last known for failed), stage (engine pipeline stage like "lipsync" while generating, "done" when complete, null otherwise), queuePosition/queueTotal (1-based position among the schedule\'s awaiting+generating slots; awaiting slots only, null otherwise). Failed slots also carry error and retryable (boolean: true when the failure looks transient). Use when the user asks about their posts — what is coming next, what already went out, how far a video has generated, where it sits in the queue, or why a post failed. Combine with list_schedules or list_social_accounts when persona/account names are needed.',
    ListPostsShape,
    withTracking('list_posts', async (args) => {
      return handleListPosts(apiClient, args);
    })
  );

  server.tool(
    'cancel_schedule',
    'Cancel (delete) an automation schedule by its schedule ID. Use list_schedules to find the ID.',
    CancelScheduleShape,
    withTracking('cancel_schedule', async (args) => {
      return handleCancelSchedule(apiClient, args);
    })
  );

  server.tool(
    'get_token_balance',
    'Get the prepaid token wallet balance. Check before triggering video generation, which costs tokens.',
    GetTokenBalanceShape,
    withTracking('get_token_balance', async () => {
      return handleGetTokenBalance(apiClient);
    })
  );

  server.tool(
    'generate_persona_videos',
    'Generate and schedule 1-10 persona videos in ONE operation. Product rule: generation is always tied to publishing — one call generates each video AND schedules its automatic publish; there is no separate schedule step and no orphan generation. personaId is REQUIRED even for faceless videos (set options.faceless: true to drop the face; the persona voice, niche, and script prompt still apply). topics is one topic per video; the server assigns publish slots (topic i lands on day startAt\'s date + floor(i/times.length) at the i-th sorted time in times). Pass providers plus per-provider account IDs (see list_social_accounts), startAt (ISO datetime, wall-clock in timezone when naive), times (HH:MM, 24h), and timezone. Every slot must be 3h-30d ahead. idempotencyKey is generated automatically; reuse it to retry without generating twice (replayed: true). Poll each slot\'s taskId with get_video_task_progress.',
    GeneratePersonaVideosShape,
    withTracking('generate_persona_videos', async (args) => {
      return handleGeneratePersonaVideos(apiClient, args);
    })
  );

  server.tool(
    'get_video_status',
    'Check the generation status and fetch final video URLs for a taskId.',
    GetVideoStatusShape,
    withTracking('get_video_status', async (args) => {
      return handleGetVideoStatus(apiClient, args);
    })
  );

  server.tool(
    'get_video_task_progress',
    'Poll one video task for its machine-readable progress: returns {task_id, state, progress, stage, error}. error is the engine failure reason when state is -1 (failed), null otherwise. Use per-video (1/6, 2/6, ...) after generate_persona_videos; prefer this over get_video_status when only progress matters.',
    GetVideoTaskProgressShape,
    withTracking('get_video_task_progress', async (args) => {
      return handleGetVideoTaskProgress(apiClient, args);
    })
  );

  server.tool(
    'list_persona_images',
    `List the image library of a persona (up to ${MAX_LIBRARY_IMAGES} tagged images). Each entry has id, tag, description, and is_primary. Use the ids with generate_persona_videos options.imageId to force a specific image for every video in one call.`,
    ListPersonaImagesShape,
    withTracking('list_persona_images', async (args) => {
      return handleListPersonaImages(apiClient, args);
    })
  );

  server.tool(
    'add_persona_image',
    `Add an image to a persona image library from a local file path (JPG/JPEG, PNG, or WebP, max ${MAX_LIBRARY_IMAGE_MB}MB). Optional tag and description drive the deterministic per-video image selection. The server rejects faceless personas and full libraries (${MAX_LIBRARY_IMAGES} max).`,
    AddPersonaImageShape,
    withTracking('add_persona_image', async (args) => {
      return handleAddPersonaImage(apiClient, args);
    })
  );

  server.tool(
    'update_persona_image',
    'Update a persona library image tag, description, or primary flag.',
    UpdatePersonaImageShape,
    withTracking('update_persona_image', async (args) => {
      return handleUpdatePersonaImage(apiClient, args);
    })
  );

  server.tool(
    'remove_persona_image',
    'Remove an image from a persona image library.',
    RemovePersonaImageShape,
    withTracking('remove_persona_image', async (args) => {
      return handleRemovePersonaImage(apiClient, args);
    })
  );

  return server;
}

export function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    // Realpath both sides: the published bin is launched through a symlinked
    // .bin entry, and Node may keep the symlink path in either argv[1] or
    // import.meta.url — realpathing both makes the comparison robust either way.
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

async function main() {
  // Fail fast: without a key every tool call would fail with an opaque 401.
  const apiKey = requireApiKey();
  const server = createPostEngineerMcpServer(new PostEngineerClient({ apiKey }));
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (isMainModule()) {
  main().catch((err) => {
    console.error('Fatal MCP Server error:', err);
    process.exit(1);
  });
}
