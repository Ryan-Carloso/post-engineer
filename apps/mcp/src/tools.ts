import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { PostEngineerClient } from './client.js';

export type McpToolResponse = CallToolResult;

export const CreatePersonaSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  avatarUrl: z.string().url().optional().nullable(),
  voiceId: z.string().default('alloy'),
  language: z.string().default('en-US'),
  videoAspect: z.enum(['9:16', '16:9']).default('9:16'),
  scriptPrompt: z.string().optional().default(''),
  paragraphNumber: z.number().int().min(1).max(5).default(1),
  niche: z.string().optional().default('General'),
  faceMixPercent: z.number().min(0).max(100).default(50),
  faceQuality: z.enum(['ok', 'very_good']).default('very_good'),
});

export const ListPersonasSchema = z.object({});

export const ListVoicesSchema = z.object({});

export const ListFacesSchema = z.object({});

export const UpdatePersonaSchema = z.object({
  personaId: z.string().min(1, 'personaId is required'),
  name: z.string().min(1).optional(),
  avatarUrl: z.string().url().optional().nullable(),
  voiceId: z.string().optional(),
  language: z.string().optional(),
  videoAspect: z.enum(['9:16', '16:9']).optional(),
  scriptPrompt: z.string().optional(),
  paragraphNumber: z.number().int().min(1).max(10).optional(),
  niche: z.string().max(300).optional(),
});

export const ListSocialAccountsSchema = z.object({});

export const ConnectAccountSchema = z.object({
  provider: z.enum(['youtube', 'instagram', 'linkedin', 'bluesky']),
  handle: z.string().min(1).optional(),
  appPassword: z.string().min(1).optional(),
});

export const ListSchedulesSchema = z.object({});

export const ListPostsSchema = z.object({
  limit: z.number().int().min(1).max(500).default(20),
});

export const CancelScheduleSchema = z.object({
  scheduleId: z.string().min(1, 'scheduleId is required'),
});

export const GetTokenBalanceSchema = z.object({});

export const GenerateVideoSchema = z.object({
  personaId: z.string().min(1, 'personaId is required'),
  scriptPrompt: z.string().optional(),
  audioUrl: z.string().url('audioUrl must be a valid URL').optional().describe('Public URL of custom audio for this video (overrides the persona voice)'),
});

export const GetVideoStatusSchema = z.object({
  taskId: z.string().min(1, 'taskId is required'),
});

export const ScheduleVideoSchema = z.object({
  personaId: z.string().min(1, 'personaId is required'),
  providers: z.array(z.enum(['youtube', 'instagram', 'linkedin'])).min(1, 'At least one provider required'),
  youtubeAccountIds: z.array(z.string()).optional().default([]),
  instagramAccountIds: z.array(z.string()).optional().default([]),
  linkedinAccountIds: z.array(z.string()).optional().default([]),
  scheduledAt: z.string().describe('Target ISO date time for scheduling. Must be between 24h and 30 days in the future.'),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  startHour: z.number().int().min(0).max(23).optional(),
  endHour: z.number().int().min(0).max(23).optional(),
  postsPerDay: z.number().int().min(1).max(10).optional(),
  timezone: z.string().optional().default('UTC'),
});

export async function handleCreatePersona(
  client: PostEngineerClient,
  args: z.infer<typeof CreatePersonaSchema>
): Promise<McpToolResponse> {
  try {
    const result = await client.createPersona(args);
    return {
      content: [
        {
          type: 'text',
          text: `Persona created successfully: ${JSON.stringify(result, null, 2)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error creating persona: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleListPersonas(
  client: PostEngineerClient
): Promise<McpToolResponse> {
  try {
    const result = await client.listPersonas();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error listing personas: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleListVoices(
  client: PostEngineerClient
): Promise<McpToolResponse> {
  try {
    const result = await client.listVoices();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error listing voices: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}


export async function handleListFaces(
  client: PostEngineerClient
): Promise<McpToolResponse> {
  try {
    const result = await client.listFaces();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error listing faces: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleUpdatePersona(
  client: PostEngineerClient,
  args: z.infer<typeof UpdatePersonaSchema>
): Promise<McpToolResponse> {
  try {
    const result = await client.updatePersona(args);
    return {
      content: [
        {
          type: 'text',
          text: `Persona updated successfully: ${JSON.stringify(result, null, 2)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error updating persona: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleListSocialAccounts(
  client: PostEngineerClient
): Promise<McpToolResponse> {
  try {
    const result = await client.listSocialAccounts();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error listing social accounts: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleConnectAccount(
  client: PostEngineerClient,
  args: z.infer<typeof ConnectAccountSchema>
): Promise<McpToolResponse> {
  if (args.provider === 'bluesky') {
    if (!args.handle || !args.appPassword) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: Bluesky requires both handle and appPassword.',
          },
        ],
        isError: true,
      };
    }
    try {
      const result = await client.connectBlueskyAccount(args.handle, args.appPassword);
      return {
        content: [
          {
            type: 'text',
            text: `Bluesky account connected successfully: ${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error connecting Bluesky account: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }

  try {
    const result = (await client.getOAuthConnectUrl(args.provider)) as { auth_url?: string };
    return {
      content: [
        {
          type: 'text',
          text:
            `To connect your ${args.provider} account, open this URL in your browser and authorize Post Engineer:\n\n` +
            `${result.auth_url}\n\n` +
            `Once you authorize, the account is connected automatically. Verify with list_social_accounts.`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting OAuth connect URL: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleListSchedules(
  client: PostEngineerClient
): Promise<McpToolResponse> {
  try {
    const result = await client.listSchedules();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error listing schedules: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleListPosts(
  client: PostEngineerClient,
  args: z.infer<typeof ListPostsSchema>
): Promise<McpToolResponse> {
  try {
    const result = await client.listPosts(args.limit);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error listing posts: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleCancelSchedule(
  client: PostEngineerClient,
  args: z.infer<typeof CancelScheduleSchema>
): Promise<McpToolResponse> {
  try {
    const result = await client.cancelSchedule(args.scheduleId);
    return {
      content: [
        {
          type: 'text',
          text: `Schedule cancelled successfully: ${JSON.stringify(result, null, 2)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error cancelling schedule: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleGetTokenBalance(
  client: PostEngineerClient
): Promise<McpToolResponse> {
  try {
    const result = await client.getTokenBalance();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting token balance: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleGenerateVideo(
  client: PostEngineerClient,
  args: z.infer<typeof GenerateVideoSchema>
): Promise<McpToolResponse> {
  try {
    const result = await client.generateVideoJob(args);
    return {
      content: [
        {
          type: 'text',
          text: `Video generation task started: ${JSON.stringify(result, null, 2)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error generating video: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleGetVideoStatus(
  client: PostEngineerClient,
  args: z.infer<typeof GetVideoStatusSchema>
): Promise<McpToolResponse> {
  try {
    const result = await client.getVideoStatus(args.taskId);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error fetching video status: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleScheduleVideo(
  client: PostEngineerClient,
  args: z.infer<typeof ScheduleVideoSchema>
): Promise<McpToolResponse> {
  try {
    const result = await client.createSchedule(args);
    return {
      content: [
        {
          type: 'text',
          text: `Video schedule created successfully: ${JSON.stringify(result, null, 2)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error scheduling video: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}
