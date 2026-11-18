import { z } from 'zod';
import { SOCIAL_PROVIDERS } from './contracts/providers.js';

export const DisconnectAccountShape = {
  provider: z
    .enum(SOCIAL_PROVIDERS)
    .describe('The social platform of the account to disconnect.'),
  providerAccountId: z
    .string()
    .min(1, 'providerAccountId is required')
    .describe(
      'The account ID on that provider (the channelId / igUserId / providerAccountId / did field from accounts (action: list)).',
    ),
};

export const DisconnectAccountSchema = z.object(DisconnectAccountShape);

export const createPersonaAccountsField = z
  .record(z.string(), z.array(z.string().min(1)))
  .refine((accounts) => Object.values(accounts).some((ids) => ids.length > 0), {
    message: 'Select at least one publishing account for this persona.',
  })
  .describe(
    'Publishing accounts this persona is bound to, per provider, e.g. { youtube: ["UC..."], bluesky: ["did:plc:..."], \'3speak\': ["alice"] }. ' +
      'At least one account is required. Account IDs come from accounts (action: list) (channelId / igUserId / providerAccountId / did).',
  );
