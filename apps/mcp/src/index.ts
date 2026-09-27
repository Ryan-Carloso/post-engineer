#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PostEngineerClient } from './client.js';
import {
  CreatePersonaShape,
  UpdatePersonaShape,
  ConnectAccountShape,
  ListPostsShape,
  CancelScheduleShape,
  GenerateVideoShape,
  GetVideoStatusShape,
  ScheduleVideoShape,
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
  handleGenerateVideo,
  handleGetVideoStatus,
  handleScheduleVideo,
} from './tools.js';

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
    async (args) => {
      return handleCreatePersona(apiClient, args);
    }
  );

  server.tool(
    'list_personas',
    'List all existing personas for the authenticated user.',
    {},
    async () => {
      return handleListPersonas(apiClient);
    }
  );

  server.tool(
    'list_voices',
    'List all available persona voices (voiceId options) for the authenticated user.',
    {},
    async () => {
      return handleListVoices(apiClient);
    }
  );

  server.tool(
    'list_faces',
    'List default/stock persona faces (avatar options). Each face includes id, url, name, gender, age (single number, not a range), ethnicity, hair, and description in English so you can pick without seeing the photo. Pass a face url as avatarUrl when calling create_persona.',
    {},
    async () => {
      return handleListFaces(apiClient);
    }
  );

  server.tool(
    'update_persona',
    'Update an existing AI persona (only the provided fields change).',
    UpdatePersonaShape,
    async (args) => {
      return handleUpdatePersona(apiClient, args);
    }
  );

  server.tool(
    'list_social_accounts',
    'List connected social accounts (YouTube, Instagram, LinkedIn) with the account IDs needed for schedule_video.',
    {},
    async () => {
      return handleListSocialAccounts(apiClient);
    }
  );

  server.tool(
    'connect_account',
    'Connect a social account. For youtube/instagram/linkedin: returns an authorization URL — the user must open it in a browser and authorize, then the account connects automatically (verify with list_social_accounts). For bluesky: connects directly with handle + appPassword (app password, not the main account password).',
    ConnectAccountShape,
    async (args) => {
      return handleConnectAccount(apiClient, args);
    }
  );

  server.tool(
    'list_schedules',
    'List all automation schedules for the authenticated user.',
    {},
    async () => {
      return handleListSchedules(apiClient);
    }
  );

  server.tool(
    'list_posts',
    'List upcoming (scheduled) and past (published/failed) posts across all connected accounts. Returns two lists: upcoming slots (id, slot_at, status, topic, schedule_id) and recent results (id, slot_at, status, topic, error, published_at, schedule_id). Use when the user asks about their posts — what is coming next, what already went out, or why a post failed. Combine with list_schedules or list_social_accounts when persona/account names are needed.',
    ListPostsShape,
    async (args) => {
      return handleListPosts(apiClient, args);
    }
  );

  server.tool(
    'cancel_schedule',
    'Cancel (delete) an automation schedule by its schedule ID. Use list_schedules to find the ID.',
    CancelScheduleShape,
    async (args) => {
      return handleCancelSchedule(apiClient, args);
    }
  );

  server.tool(
    'get_token_balance',
    'Get the prepaid token wallet balance. Check before triggering video generation, which costs tokens.',
    {},
    async () => {
      return handleGetTokenBalance(apiClient);
    }
  );

  server.tool(
    'generate_video_from_persona',
    'Trigger video generation using an existing persona. Optional scriptPrompt overrides the video script; optional audioUrl (public http(s) URL) supplies custom audio for this video, overriding the persona voice.',
    GenerateVideoShape,
    async (args) => {
      return handleGenerateVideo(apiClient, args);
    }
  );

  server.tool(
    'get_video_status',
    'Check the generation status and fetch final video URLs for a taskId.',
    GetVideoStatusShape,
    async (args) => {
      return handleGetVideoStatus(apiClient, args);
    }
  );

  server.tool(
    'schedule_video',
    'Schedule automated video generation and posting to social channels. IMPORTANT: Schedules must be between 24h and 30 days in advance. Each provider requires at least one account ID — discover them with list_social_accounts first.',
    ScheduleVideoShape,
    async (args) => {
      return handleScheduleVideo(apiClient, args);
    }
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
