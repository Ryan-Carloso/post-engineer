// accounts (action: connect): shape, schema and handler.
//
// Extracted from tools.ts so tools.ts stays under the file-size ratchet.
// Re-exported from tools.ts, so existing import sites (`./tools.js`) keep
// working, including the personas and accounts registration (intent-*.ts).
import { z } from 'zod';

import type { PostEngineerClient } from './client.js';
import { SOCIAL_PROVIDERS, isOAuthConnectProvider, type DirectConnectProvider } from './contracts/providers.js';
import { getErrorMessage } from './errors.js';
import { redactSecretFromError } from './secret-redaction.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';

// A credential present but blank is rejected with the same message the
// route uses — the route trims and rejects blanks, so the tool does too.
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
  // One handler per direct-connect network (a record, not a chain): a new
  // direct-connect network fails the typecheck until it has a handler,
  // instead of falling through to the OAuth URL path. Bluesky and 3Speak
  // project the upstream response to named fields (Telegram too, with the
  // bot token redacted from any error); Rumble shares
  // handleLibraryCall, which renders the same success/error text. Built
  // inside the handler so the parity check, which follows calls from the
  // action's own body, sees each network's client call.
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
        // Project the upstream response to named fields: stringifying the
        // whole body would surface any field the route adds later.
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
        // Project the upstream response to named fields: stringifying the
        // whole body would surface any field the route adds later.
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
        const result = await client.connectTelegramAccount(args.botToken, args.chatId, args.chatType);
        // Project the upstream response to named fields: stringifying the
        // whole body would surface any field the route adds later.
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
    // Never echo a non-https URL as a "open in your browser" authorization
    // link: z.string().url() accepts any scheme, including javascript:.
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
