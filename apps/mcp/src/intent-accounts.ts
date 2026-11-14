import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { actionDescription, actionShape, byAction } from './action-tool.js';
import type { PostEngineerClient } from './client.js';
import { ConnectAccountShape, handleConnectAccount } from './connect-account.js';
import { personaRefShape, resolveAccountRef, withPersona } from './refs.js';
import { withRecipeNudge, type RecipeSession } from './recipe-session.js';
import { DESTRUCTIVE } from './tool-annotations.js';
import { DisconnectAccountShape, handleDisconnectAccount, handleListSocialAccounts } from './tools.js';
import type { McpToolResponse } from './tools-call.js';
import { GetPersonaPublishingAccountsShape, SetPersonaPublishingAccountsShape, handleGetPersonaPublishingAccounts, handleSetPersonaPublishingAccounts } from './tools-publishing-accounts.js';
import { handleListPinterestBoards } from './tools-pinterest.js';

//---------------
// accounts (issue #566): connected social accounts and the accounts each
// persona publishes to. An account is given by name or id (refs.ts); the
// network is read from the account.
//---------------

const PROVIDERS = DisconnectAccountShape.provider;

const ACCOUNTS_SPECS = {
  list: { provider: PROVIDERS.optional().describe('Only the accounts of this network.') },
  connect: ConnectAccountShape,
  disconnect: {
    account: z.string().min(1, 'account is required').describe('The account to disconnect, by name or id (accounts list shows both).'),
    provider: PROVIDERS.optional().describe('Narrow a name that exists on several networks.'),
  },
  get_persona_publishing: personaRefShape(GetPersonaPublishingAccountsShape),
  set_persona_publishing: personaRefShape(SetPersonaPublishingAccountsShape),
  list_boards: { account: z.string().min(1, 'account is required').describe('The Pinterest account, by name or id.') },
};

export const AccountsDescription = actionDescription(
  'Connected social accounts. list: every account with the ids and names to publish with (YouTube, Instagram, LinkedIn, Threads, Facebook, Bluesky, Pinterest, 3Speak, Rumble, Fanvue). connect: starts the connection of a network (an OAuth link to open, or a direct connect for Bluesky, 3Speak and Rumble). disconnect: removes an account. get_persona_publishing / set_persona_publishing: the accounts a persona publishes to by default (set replaces the whole set and must keep at least one). list_boards: the boards of a Pinterest account.',
  ACCOUNTS_SPECS,
);

function filterByProvider(response: McpToolResponse, provider: string | undefined): McpToolResponse {
  if (provider === undefined || response.isError === true) return response;
  const [first] = response.content;
  if (first?.type !== 'text') return response;
  try {
    const parsed: unknown = JSON.parse(first.text);
    const accounts = typeof parsed === 'object' && parsed !== null ? (parsed as { accounts?: unknown }).accounts : undefined;
    if (!Array.isArray(accounts)) return response;
    const kept = accounts.filter((entry) => typeof entry === 'object' && entry !== null && (entry as { provider?: unknown }).provider === provider);
    return { ...response, content: [{ type: 'text', text: JSON.stringify({ ...(parsed as object), accounts: kept }, null, 2) }] };
  } catch {
    return response;
  }
}

export function registerAccountTools(server: McpServer, client: PostEngineerClient, session: RecipeSession): void {
  server.tool(
    'accounts',
    AccountsDescription,
    actionShape(ACCOUNTS_SPECS),
    DESTRUCTIVE,
    byAction(
      {
        list: withRecipeNudge(session, 'accounts_list', async (args) => filterByProvider(await handleListSocialAccounts(client), args.provider)),
        connect: async (args) => handleConnectAccount(client, args),
        disconnect: async (args) => {
          const outcome = await resolveAccountRef(client, args.account, args.provider);
          if (outcome.kind === 'response') return outcome.response;
          return handleDisconnectAccount(client, { provider: outcome.value.provider as typeof args.provider & string, providerAccountId: outcome.value.id });
        },
        get_persona_publishing: (args) => withPersona(client, args, (resolved) => handleGetPersonaPublishingAccounts(client, resolved)),
        set_persona_publishing: (args) => withPersona(client, args, (resolved) => handleSetPersonaPublishingAccounts(client, resolved)),
        list_boards: async (args) => {
          const outcome = await resolveAccountRef(client, args.account, 'pinterest');
          if (outcome.kind === 'response') return outcome.response;
          return handleListPinterestBoards(client, { accountId: outcome.value.id });
        },
      },
      ACCOUNTS_SPECS,
      'accounts',
    ),
  );
}
