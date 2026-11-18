// accounts (action: connect): shape, schema and handler.
//
// Extracted from tools.ts so tools.ts stays under the file-size ratchet.
// Re-exported from tools.ts, so existing import sites (`./tools.js`) keep
// working, including the personas and accounts registration (intent-*.ts).
import { z } from 'zod';

import type { PostEngineerClient } from './client.js';
import { SOCIAL_PROVIDERS, isOAuthConnectProvider, type DirectConnectProvider } from './contracts/providers.js';
import { getErrorMessage } from './errors.js';
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
  handle: nonBlank('Bluesky handle is required.').optional().describe('Bluesky handle (e.g. user.bsky.social). Required only for bluesky.'),
  appPassword: nonBlank('Bluesky app password is required.').optional().describe('Bluesky app password (Settings > App passwords). Required only for bluesky. Never shared or logged.'),
  username: nonBlank('Hive username is required.').optional().describe('Hive username (e.g. alice). Required only for 3speak.'),
  postingKey: nonBlank('Hive posting key is required.').optional().describe('Hive posting key (the posting key only — never the owner, active, or master password). Required only for 3speak. Never shared or logged.'),
  channelId: nonBlank('Rumble channel ID is required.').optional().describe('Rumble channel ID. Required only for rumble.'),
  accessToken: nonBlank('Rumble access token is required.').optional().describe('Rumble 40-character Simple Upload API access token (issued by emailing bd@rumble.com). Required only for rumble. Never shared or logged.'),
};

export const ConnectAccountSchema = z.object(ConnectAccountShape);

type ConnectAccountArgs = z.infer<typeof ConnectAccountSchema>;
type DirectConnectHandler = (client: PostEngineerClient, args: ConnectAccountArgs) => Promise<McpToolResponse>;

// One handler per direct-connect network (a record, not a chain): a new
// direct-connect network fails the typecheck until it has a handler,
// instead of falling through to the OAuth URL path. Bluesky and 3Speak
// project the upstream response to named fields; Rumble shares
// handleLibraryCall, which renders the same success/error text.
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
};

export async function handleConnectAccount(
  client: PostEngineerClient,
  args: z.infer<typeof ConnectAccountSchema>
): Promise<McpToolResponse> {
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
