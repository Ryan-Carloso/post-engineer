// Connect/disconnect account shapes. Kept in a new module so tools.ts stays
// under the file-size ratchet; tools.ts re-exports them so existing import
// sites (`./tools.js`) keep working.
import { z } from 'zod';

export const ConnectAccountShape = {
  provider: z.enum(['youtube', 'instagram', 'linkedin', 'bluesky', 'threads', 'facebook', 'pinterest', '3speak']).describe('The social platform to connect'),
  handle: z.string().min(1).optional().describe('Bluesky handle (e.g. user.bsky.social). Required only for bluesky.'),
  appPassword: z.string().min(1).optional().describe('Bluesky app password (Settings > App passwords). Required only for bluesky. Never shared or logged.'),
  username: z.string().min(1).optional().describe('Hive username (e.g. alice). Required only for 3speak.'),
  postingKey: z.string().min(1).optional().describe('Hive posting key (the posting key only — never the owner, active, or master password). Required only for 3speak. Never shared or logged.'),
};

export const ConnectAccountSchema = z.object(ConnectAccountShape);

export const DisconnectAccountShape = {
  provider: z
    .enum(['youtube', 'instagram', 'linkedin', 'bluesky', 'threads', 'facebook', 'pinterest', '3speak'])
    .describe('The social platform of the account to disconnect.'),
  providerAccountId: z
    .string()
    .min(1, 'providerAccountId is required')
    .describe(
      'The account ID on that provider (the channelId / igUserId / providerAccountId / did field from list_social_accounts).',
    ),
};

export const DisconnectAccountSchema = z.object(DisconnectAccountShape);
