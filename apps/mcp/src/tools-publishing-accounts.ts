import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import {
  getPersonaPublishingAccounts,
  setPersonaPublishingAccounts,
} from './client-publishing-accounts.js';
import { handleLibraryCall, type McpToolResponse } from './tools.js';

//---------------
// Per-persona bound publishing accounts (issue #212; made mandatory by
// issue #572) — MCP tools.
//
// Since issue #212, omitting all four provider account-id fields in
// generate_persona_video falls back to the persona's bound publishing
// accounts (set via set_persona_publishing_accounts); explicit ids must
// be a subset of the binding. The binding as a whole must keep at least
// one account: it can never be emptied.
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
      'Publishing accounts the persona is bound to, per provider, e.g. { youtube: ["UC..."], bluesky: ["did:plc:..."], \'3speak\': ["alice"] }. ' +
        'Replaces the whole set: providers mapped to [] (or omitted) keep no binding for that provider, but the binding as a whole must keep at least one account (issue #572). ' +
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
