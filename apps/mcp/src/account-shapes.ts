// Connect/disconnect account shapes. Kept in a new module so tools.ts stays
// under the file-size ratchet; tools.ts re-exports them so existing import
// sites (`./tools.js`) keep working.
import { z } from 'zod';

export const DisconnectAccountShape = {
  provider: z
    .enum(['youtube', 'instagram', 'linkedin', 'bluesky', 'threads', 'facebook', 'pinterest', 'fanvue', '3speak', 'rumble'])
    .describe('The social platform of the account to disconnect.'),
  providerAccountId: z
    .string()
    .min(1, 'providerAccountId is required')
    .describe(
      'The account ID on that provider (the channelId / igUserId / providerAccountId / did field from list_social_accounts).',
    ),
};

export const DisconnectAccountSchema = z.object(DisconnectAccountShape);
