import { z } from 'zod';

import type { PostEngineerClient } from './client.js';
import { connectTelegramAccount } from './client-telegram.js';
import { SOCIAL_PROVIDERS, isOAuthConnectProvider, type DirectConnectProvider } from './contracts/providers.js';
import { getErrorMessage } from './errors.js';
import { redactSecretFromError } from './secret-redaction.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';

function nonBlank(message: string) {
  return z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0, { message });
}

export const ConnectAccountShape = {
  provider: z.enum(SOCIAL_PROVIDERS).describe('The social platform to connect'),
  handle: nonBlank('Bluesky handle is required.').optional().describe('bluesky only: the handle (e.g. user.bsky.social).'),
  appPassword: nonBlank('Bluesky app password is required.').optional().describe('bluesky only: an app password (Settings > App passwords). Never logged.'),
  username: nonBlank('Hive username is required.').optional().describe('3speak only: the Hive username.'),
  postingKey: nonBlank('Hive posting key is required.').optional().describe('3speak only: the Hive posting key (never the owner/active/master key). Never logged.'),
  channelId: nonBlank('Rumble channel ID is required.').optional().describe('rumble only: the channel ID.'),
  accessToken: nonBlank('Rumble access token is required.').optional().describe('rumble only: the upload access token (from bd@rumble.com). Never logged.'),
  botToken: nonBlank('Telegram bot token is required.').optional().describe('telegram only: the @BotFather bot token. Never logged.'),
  chatId: nonBlank('Telegram chat ID or @username is required.').optional().describe('telegram only: @username or numeric chat ID.'),
  chatType: z.enum(['channel', 'group']).optional().describe('telegram only: channel or group.'),
};

export const ConnectAccountSchema = z.object(ConnectAccountShape);

type ConnectAccountArgs = z.infer<typeof ConnectAccountSchema>;
type DirectConnectHandler = (client: PostEngineerClient, args: ConnectAccountArgs) => Promise<McpToolResponse>;

export async function handleConnectAccount(
  client: PostEngineerClient,
  args: z.infer<typeof ConnectAccountSchema>
): Promise<McpToolResponse> {
  const DIRECT_CONNECT_HANDLERS: Record<DirectConnectProvider, DirectConnectHandler> = {
    bluesky: async (client, args) => {
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
        const { accountId, did } = result;
        return {
          content: [
            {
              type: 'text',
              text: `Bluesky account connected successfully: accountId=${accountId} did=${did}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error connecting Bluesky account: ${getErrorMessage(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
    '3speak': async (client, args) => {
      if (!args.username || !args.postingKey) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: 3Speak requires both username and postingKey.',
            },
          ],
          isError: true,
        };
      }
      try {
        const result = await client.connectThreespeakAccount(args.username, args.postingKey);
        const { accountId, username } = result;
        return {
          content: [
            {
              type: 'text',
              text: `3Speak account connected successfully: username=${username} accountId=${accountId}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error connecting 3Speak account: ${getErrorMessage(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
    rumble: (client, args) => {
      if (!args.channelId || !args.accessToken) {
        return Promise.resolve({
          content: [
            {
              type: 'text',
              text: 'Error: Rumble requires both channelId and accessToken.',
            },
          ],
          isError: true,
        });
      }
      const channelId = args.channelId;
      const accessToken = args.accessToken;
      return handleLibraryCall(
        () => client.connectRumbleAccount(channelId, accessToken),
        'connecting Rumble account',
        'Rumble account connected successfully',
      );
    },
    telegram: async (client, args) => {
      if (!args.botToken || !args.chatId || !args.chatType) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Telegram requires botToken, chatId and chatType (channel or group).',
            },
          ],
          isError: true,
        };
      }
      try {
        const result = await connectTelegramAccount(client, args.botToken, args.chatId, args.chatType);
        const { accountId, chatId, chatType, title } = result;
        return {
          content: [
            {
              type: 'text',
              text: `Telegram account connected successfully: chatId=${chatId} chatType=${chatType} title=${title} accountId=${accountId}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error connecting Telegram account: ${getErrorMessage(redactSecretFromError(error, args.botToken))}`,
            },
          ],
          isError: true,
        };
      }
    },
  };
  if (!isOAuthConnectProvider(args.provider)) {
    return DIRECT_CONNECT_HANDLERS[args.provider](client, args);
  }

  try {
    const parsed = z.object({ auth_url: z.string().url() }).safeParse(await client.getOAuthConnectUrl(args.provider));
    if (!parsed.success) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: the connect endpoint did not return an auth_url.',
          },
        ],
        isError: true,
      };
    }
    const result = parsed.data;
    if (new URL(result.auth_url).protocol !== 'https:') {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: the connect endpoint returned a non-https auth_url.',
          },
        ],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: 'text',
          text:
            `To connect your ${args.provider} account, open this URL in a browser where you are signed in to Post Engineer with the same account as this API key, and authorize Post Engineer:\n\n` +
            `${result.auth_url}\n\n` +
            `Once you authorize, the account is connected automatically. Verify with accounts (action: list).`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting OAuth connect URL: ${getErrorMessage(error)}`,
        },
      ],
      isError: true,
    };
  }
}
