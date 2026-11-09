// connect_account: shape, schema and handler.
//
// Extracted from tools.ts so tools.ts stays under the file-size ratchet.
// Re-exported from tools.ts, so existing import sites (`./tools.js`) keep
// working, including the tool registration in index.ts.
import { z } from 'zod';

import type { PostEngineerClient } from './client.js';
import { getErrorMessage } from './errors.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';

export const ConnectAccountShape = {
  provider: z.enum(['youtube', 'instagram', 'linkedin', 'bluesky', 'threads', 'facebook', 'rumble']).describe('The social platform to connect'),
  handle: z.string().min(1).optional().describe('Bluesky handle (e.g. user.bsky.social). Required only for bluesky.'),
  appPassword: z.string().min(1).optional().describe('Bluesky app password (Settings > App passwords). Required only for bluesky. Never shared or logged.'),
  channelId: z.string().min(1).optional().describe('Rumble channel ID. Required only for rumble.'),
  accessToken: z.string().min(1).optional().describe('Rumble 40-character Simple Upload API access token (issued by emailing bd@rumble.com). Required only for rumble. Never shared or logged.'),
};

export const ConnectAccountSchema = z.object(ConnectAccountShape);

export async function handleConnectAccount(
  client: PostEngineerClient,
  args: z.infer<typeof ConnectAccountSchema>
): Promise<McpToolResponse> {
  // Bluesky and Rumble connect directly (app password / access token),
  // no OAuth URL: both branches share handleLibraryCall, which renders
  // the same success/error text the hand-built blocks used to.
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
    // Locals: narrowing on args.handle does not survive into the closure
    // below, so capture the guarded values first.
    const handle = args.handle;
    const appPassword = args.appPassword;
    return handleLibraryCall(
      () => client.connectBlueskyAccount(handle, appPassword),
      'connecting Bluesky account',
      'Bluesky account connected successfully',
    );
  }
  if (args.provider === 'rumble') {
    if (!args.channelId || !args.accessToken) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: Rumble requires both channelId and accessToken.',
          },
        ],
        isError: true,
      };
    }
    const channelId = args.channelId;
    const accessToken = args.accessToken;
    return handleLibraryCall(
      () => client.connectRumbleAccount(channelId, accessToken),
      'connecting Rumble account',
      'Rumble account connected successfully',
    );
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
            `Once you authorize, the account is connected automatically. Verify with list_social_accounts.`,
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
