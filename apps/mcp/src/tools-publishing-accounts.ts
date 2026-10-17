import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import {
  getPersonaPublishingAccounts,
  setPersonaPublishingAccounts,
} from './client-publishing-accounts.js';
import { handleLibraryCall, type McpToolResponse } from './tools.js';

//---------------
// Per-persona default publishing accounts (issue #212) — MCP tools.
//
// Extracted from tools.ts so the tools module stays under the file-size
// ratchet. Since issue #212, omitting all four provider account-id fields
// in generate_persona_videos falls back to the persona's default publishing
// accounts (set via set_persona_publishing_accounts); explicit ids always
// win.
//---------------

export const GetPersonaPublishingAccountsShape = {
  personaId: z
    .string()
    .min(1, 'personaId is required')
    .describe('The persona ID whose default publishing accounts to list.'),
};

export const GetPersonaPublishingAccountsSchema = z.object(GetPersonaPublishingAccountsShape);

export const SetPersonaPublishingAccountsShape = {
  personaId: z
    .string()
    .min(1, 'personaId is required')
    .describe('The persona ID whose default publishing accounts to replace.'),
  accounts: z
    .record(z.string(), z.array(z.string().min(1)))
    .describe(
      'Default publishing accounts per provider, e.g. { youtube: ["UC..."], bluesky: ["did:plc:..."] }. ' +
        'Replaces the whole set: providers mapped to [] (or omitted) keep no defaults. ' +
        'Account IDs come from list_social_accounts (channelId / igUserId / providerAccountId / did).'
    ),
};

export const SetPersonaPublishingAccountsSchema = z.object(SetPersonaPublishingAccountsShape);

export async function handleGetPersonaPublishingAccounts(
  client: PostEngineerClient,
  args: z.infer<typeof GetPersonaPublishingAccountsSchema>
): Promise<McpToolResponse> {
  return handleLibraryCall(
    () => getPersonaPublishingAccounts(client, args.personaId),
    'getting persona publishing accounts'
  );
}

export async function handleSetPersonaPublishingAccounts(
  client: PostEngineerClient,
  args: z.infer<typeof SetPersonaPublishingAccountsSchema>
): Promise<McpToolResponse> {
  return handleLibraryCall(
    () => setPersonaPublishingAccounts(client, args.personaId, args.accounts),
    'setting persona publishing accounts',
    'Persona publishing accounts updated successfully'
  );
}
