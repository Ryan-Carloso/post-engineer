import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { actionDescription, actionShape, byAction, offeredSpecs, type ActionOptions } from './action-tool.js';
import type { PostEngineerClient } from './client.js';
import { getPersonaPublishingAccounts } from './client-publishing-accounts.js';
import { MalformedContractResponseError } from './contract-response.js';
import { handlePersonaDelete } from './persona-delete.js';
import { GetCardShape, RenderPromptShape, handleGetPersonaCard, handleRenderPersonaPrompt } from './persona-card-actions.js';
import { UpdatePersonaShape, handleUpdatePersona } from './persona-update.js';
import { PERSONA_REF, personaRefShape, withPersona } from './refs.js';
import { withRecipeNudge, type RecipeSession } from './recipe-session.js';
import { CreatePersonaRemoteSchema, CreatePersonaRemoteShape, UpdatePersonaRemoteSchema, UpdatePersonaRemoteShape } from './remote-shapes.js';
import { DESTRUCTIVE, READ_ONLY } from './tool-annotations.js';
import { POINTER_IMAGES, POINTER_PERSONA_ACCOUNTS } from './server-instructions.js';
import { CreatePersonaSchema, CreatePersonaShape, handleCreatePersona, handleLibraryCall, handleListPersonas } from './tools.js';
import type { McpToolResponse } from './tools-call.js';

const DeleteFields = {
  persona: PERSONA_REF.describe('The persona to delete, by name or id. DESTRUCTIVE and irreversible.'),
  confirmToken: z.string().min(1).optional().describe('Omit it first: the call only previews what would be removed and returns a token. Send that token to delete.'),
};

const PERSONAS_SPECS = {
  list: {},
  get: { persona: PERSONA_REF },
  create: CreatePersonaShape,
  update: personaRefShape(UpdatePersonaShape),
  delete: DeleteFields,
};

function personasOptions(remote: boolean): ActionOptions<typeof PERSONAS_SPECS> {
  return remote ? { variants: { create: CreatePersonaRemoteShape, update: personaRefShape(UpdatePersonaRemoteShape) } } : {};
}

function personasDescription(remote: boolean): string {
  const photo = remote ? 'no photo (the web app sets it)' : 'an optional avatarPath (a local photo shown on the persona card, uploaded directly)';
  return actionDescription(
    `Manage your personas (a named group of publishing accounts with an optional photo and identity card). list: names and ids. get: one persona with its bound publishing accounts. create: at least one publishing account (accounts) is REQUIRED; ${photo}. update: only the given fields change (identityCard sets or, with null, removes the identity card; see persona_media get_card and render_prompt). delete: preview first, then confirm with the token. ${POINTER_PERSONA_ACCOUNTS}`,
    offeredSpecs(PERSONAS_SPECS, personasOptions(remote)),
  );
}

async function getPersona(client: PostEngineerClient, args: { personaId: string }): Promise<McpToolResponse> {
  return handleLibraryCall(async () => {
    const [listing, publishing] = await Promise.all([
      client.listPersonas(),
      getPersonaPublishingAccounts(client, args.personaId).catch((error) => {
        if (error instanceof MalformedContractResponseError) return undefined;
        throw error;
      }),
    ]);
    const persona = listing.personas.find((entry) => entry.id === args.personaId);
    if (persona === undefined) throw new Error(`No persona with id ${args.personaId}. Call personas with action "list" to see them.`);
    return { persona, boundAccounts: publishing?.defaults ?? null };
  }, 'getting persona');
}

export function registerPersonaTools(server: McpServer, client: PostEngineerClient, session: RecipeSession, remote: boolean): void {
  const options = personasOptions(remote);
  server.tool(
    'personas',
    personasDescription(remote),
    actionShape(offeredSpecs(PERSONAS_SPECS, options)),
    DESTRUCTIVE,
    byAction(
      {
        list: withRecipeNudge(session, 'personas_list', async () => handleListPersonas(client)),
        get: (args) => withPersona(client, args, (resolved) => getPersona(client, resolved)),
        create: withRecipeNudge(session, 'personas_create', async (args) => handleCreatePersona(client, remote ? CreatePersonaRemoteSchema.parse(args) : CreatePersonaSchema.parse(args))),
        update: (args) => withPersona(client, args, (resolved) => handleUpdatePersona(client, remote ? UpdatePersonaRemoteSchema.parse(resolved) : resolved)),
        delete: (args) => withPersona(client, args, (resolved) => handlePersonaDelete(client, resolved)),
      },
      PERSONAS_SPECS,
      'personas',
      options,
    ),
  );
}

const MEDIA_SPECS = {
  get_card: personaRefShape(GetCardShape),
  render_prompt: personaRefShape(RenderPromptShape),
};

export function registerPersonaMediaTools(server: McpServer, client: PostEngineerClient): void {
  server.tool(
    'persona_media',
    actionDescription(
      `A persona's identity card. get_card: the persona's identity card (set with personas update identityCard), or null. render_prompt: renders a deterministic image-edit prompt from the card plus a scene (style, outfit, pose, setting, lighting, framing) and returns { prompt, suggestedDescription }; it is advice for YOUR image tool, nothing is generated or stored. The card describes a real person's physical traits: nude or sexualised clothing is rejected, and the server cannot police what your image tool makes. ${POINTER_IMAGES}`,
      MEDIA_SPECS,
    ),
    actionShape(MEDIA_SPECS),
    READ_ONLY,
    byAction(
      {
        get_card: (args) => withPersona(client, args, (resolved) => handleGetPersonaCard(client, resolved)),
        render_prompt: (args) => withPersona(client, args, (resolved) => handleRenderPersonaPrompt(client, resolved)),
      },
      MEDIA_SPECS,
      'persona_media',
    ),
  );
}
