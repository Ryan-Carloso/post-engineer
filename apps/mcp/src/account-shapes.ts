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
      'The account ID on that provider (the channelId / igUserId / providerAccountId / did field from accounts (action: list)).',
    ),
};

export const DisconnectAccountSchema = z.object(DisconnectAccountShape);

//---------------
// createPersonaAccountsField — the bound publishing accounts a new
// persona is born with (issue #572). Lives here (not in tools.ts) so
// tools.ts stays under the file-size ratchet: a persona is born bound
// to at least one publishing account — videos publish only to bound
// accounts, and a persona with no bound account cannot exist. The
// server enforces the same rule; the refine fails the call here first,
// before any file is read.
//---------------
export const createPersonaAccountsField = z
  .record(z.string(), z.array(z.string().min(1)))
  .refine((accounts) => Object.values(accounts).some((ids) => ids.length > 0), {
    message: 'Select at least one publishing account for this persona.',
  })
  .describe(
    'Publishing accounts this persona is bound to, per provider, e.g. { youtube: ["UC..."], bluesky: ["did:plc:..."], \'3speak\': ["alice"] }. ' +
      'At least one account is required. Account IDs come from accounts (action: list) (channelId / igUserId / providerAccountId / did).',
  );
