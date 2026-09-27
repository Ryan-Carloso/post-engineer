#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { PostEngineerClient } from './client.js';
import {
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
import { startHttpServer } from './http.js';

export function createPostEngineerMcpServer(client?: PostEngineerClient): McpServer {
  const apiClient = client ?? new PostEngineerClient({ apiKey: process.env.POST_ENGINEER_API_KEY });
  const server = new McpServer({
    name: 'post-engineer-mcp',
    version: '1.1.0',
  });

  server.tool(
    'create_persona',
    'Create a new AI persona with avatar, voice, language, and niche prompt.',
    {
      name: z.string().min(1, 'Name is required').describe('Name of the persona'),
      avatarUrl: z.string().url().optional().nullable().describe('Public URL to the persona avatar image (use list_faces for stock face URLs)'),
      voiceId: z.string().default('alloy').describe('Voice ID to use (e.g. alloy, echo)'),
      language: z.string().default('en-US').describe('Language code (e.g. pt-BR, en-US)'),
      videoAspect: z.enum(['9:16', '16:9']).default('9:16').describe('Video aspect ratio'),
      scriptPrompt: z.string().optional().default('').describe('System prompt instructions for video scripts'),
      paragraphNumber: z.number().int().min(1).max(5).default(1).describe('Number of paragraphs'),
      niche: z.string().optional().default('General').describe('Content niche topic'),
      faceMixPercent: z.number().min(0).max(100).default(50),
       faceQuality: z.enum(['ok', 'very_good']).default('very_good'),
    },
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
    {
      personaId: z.string().min(1, 'personaId is required').describe('The ID of the persona to update'),
      name: z.string().min(1).optional().describe('New name for the persona'),
      avatarUrl: z.string().url().optional().nullable().describe('New public avatar image URL'),
      voiceId: z.string().optional().describe('New voice ID (see list_voices)'),
      language: z.string().optional().describe('New language code (e.g. pt-BR, en-US)'),
      videoAspect: z.enum(['9:16', '16:9']).optional().describe('New video aspect ratio'),
      scriptPrompt: z.string().optional().describe('New system prompt instructions for video scripts'),
      paragraphNumber: z.number().int().min(1).max(10).optional().describe('New number of paragraphs'),
      niche: z.string().max(300).optional().describe('New content niche topic'),
    },
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
    {
      provider: z.enum(['youtube', 'instagram', 'linkedin', 'bluesky']).describe('The social platform to connect'),
      handle: z.string().min(1).optional().describe('Bluesky handle (e.g. user.bsky.social). Required only for bluesky.'),
      appPassword: z.string().min(1).optional().describe('Bluesky app password (Settings > App passwords). Required only for bluesky. Never shared or logged.'),
    },
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
    {
      limit: z.number().int().min(1).max(500).default(20).describe('Max number of upcoming and past posts to return (each list). Default 20, max 500.'),
    },
    async (args) => {
      return handleListPosts(apiClient, args);
    }
  );

  server.tool(
    'cancel_schedule',
    'Cancel (delete) an automation schedule by its schedule ID. Use list_schedules to find the ID.',
    {
      scheduleId: z.string().min(1, 'scheduleId is required').describe('The ID of the schedule to cancel'),
    },
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
    {
      personaId: z.string().min(1, 'personaId is required').describe('The ID of the persona to generate video with'),
      scriptPrompt: z.string().optional().describe('Optional specific prompt override for this video'),
      audioUrl: z.string().url('audioUrl must be a valid URL').optional().describe('Optional public URL of custom audio for this video (overrides the persona voice)'),
    },
    async (args) => {
      return handleGenerateVideo(apiClient, args);
    }
  );

  server.tool(
    'get_video_status',
    'Check the generation status and fetch final video URLs for a taskId.',
    {
      taskId: z.string().min(1, 'taskId is required').describe('The video generation task ID'),
    },
    async (args) => {
      return handleGetVideoStatus(apiClient, args);
    }
  );

  server.tool(
    'schedule_video',
    'Schedule automated video generation and posting to social channels. IMPORTANT: Schedules must be between 24h and 30 days in advance. Each provider requires at least one account ID — discover them with list_social_accounts first.',
    {
      personaId: z.string().min(1, 'personaId is required').describe('The ID of the persona'),
      providers: z
        .array(z.enum(['youtube', 'instagram', 'linkedin']))
        .min(1, 'At least one provider required')
        .describe('Target social platforms'),
      youtubeAccountIds: z.array(z.string()).optional().default([]),
      instagramAccountIds: z.array(z.string()).optional().default([]),
      linkedinAccountIds: z.array(z.string()).optional().default([]),
      scheduledAt: z
        .string()
        .describe('Target ISO date time for scheduling. Must be between 24h and 30 days in the future.'),
      daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
      startHour: z.number().int().min(0).max(23).optional(),
      endHour: z.number().int().min(0).max(23).optional(),
      postsPerDay: z.number().int().min(1).max(10).optional(),
      timezone: z.string().optional().default('UTC'),
    },
    async (args) => {
      return handleScheduleVideo(apiClient, args);
    }
  );

  return server;
}

import { fileURLToPath } from 'url';

export function isMainModule(): boolean {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

async function main() {
  if (process.argv.includes('--http')) {
    await startHttpServer();
    return;
  }

  const server = createPostEngineerMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (isMainModule()) {
  main().catch((err) => {
    console.error('Fatal MCP Server error:', err);
    process.exit(1);
  });
}
