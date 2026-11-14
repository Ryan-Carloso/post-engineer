import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { actionDescription, actionShape, byAction, offeredSpecs, type ActionOptions } from './action-tool.js';
import type { PostEngineerClient } from './client.js';
import { getPersonaPublishingAccounts } from './client-publishing-accounts.js';
import { handlePersonaDelete } from './persona-delete.js';
import { UpdatePersonaShape, handleUpdatePersona } from './persona-update.js';
import { PERSONA_REF, personaRefShape, withPersona } from './refs.js';
import { withRecipeNudge, type RecipeSession } from './recipe-session.js';
import { CreatePersonaRemoteSchema, CreatePersonaRemoteShape, UpdatePersonaRemoteSchema, UpdatePersonaRemoteShape } from './remote-shapes.js';
import { DESTRUCTIVE } from './tool-annotations.js';
import {
  AddPersonaImageShape,
  CreatePersonaSchema,
  CreatePersonaShape,
  ListFacesShape,
  ListPersonaImagesShape,
  RemovePersonaImageShape,
  UpdatePersonaImageShape,
  handleAddPersonaImage,
  handleCreatePersona,
  handleLibraryCall,
  handleListFaces,
  handleListPersonaImages,
  handleListPersonas,
  handleRemovePersonaImage,
  handleUpdatePersonaImage,
} from './tools.js';
import type { McpToolResponse } from './tools-call.js';

//---------------
// personas and persona_media (issue #566). A persona is given by name or id
// (refs.ts); delete is preview-then-confirm (persona-delete.ts).
//---------------

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

// The remote server takes avatarUrl only: no field names a file on disk.
function personasOptions(remote: boolean): ActionOptions<typeof PERSONAS_SPECS> {
  return remote ? { variants: { create: CreatePersonaRemoteShape, update: personaRefShape(UpdatePersonaRemoteShape) } } : {};
}

export function personasDescription(remote: boolean): string {
  const face = remote ? 'avatarUrl (a public URL or a url from persona_media (action: list_faces))' : 'avatarUrl or avatarPath (a local photo, uploaded directly)';
  return actionDescription(
    `Manage your personas (the on-camera presenter, voice and defaults). list: names and ids. get: one persona with its image count and bound publishing accounts. create: a face is REQUIRED (${face}) and at least one publishing account (accounts); a faceless video is chosen per video, not per persona. update: only the given fields change. delete: preview first, then confirm with the token.`,
    offeredSpecs(PERSONAS_SPECS, personasOptions(remote)),
  );
}

async function getPersona(client: PostEngineerClient, args: { personaId: string }): Promise<McpToolResponse> {
  return handleLibraryCall(async () => {
    const [listing, images, publishing] = await Promise.all([
      client.listPersonas(),
      client.listPersonaImages(args.personaId),
      getPersonaPublishingAccounts(client, args.personaId),
    ]);
    const personas = typeof listing === 'object' && listing !== null ? (listing as { personas?: unknown }).personas : undefined;
    const persona = Array.isArray(personas) ? personas.find((entry) => typeof entry === 'object' && entry !== null && (entry as { id?: unknown }).id === args.personaId) : undefined;
    if (persona === undefined) throw new Error(`No persona with id ${args.personaId}. Call personas with action "list" to see them.`);
    const imageList = typeof images === 'object' && images !== null ? (images as { images?: unknown }).images : undefined;
    const defaults = typeof publishing === 'object' && publishing !== null ? (publishing as { defaults?: unknown }).defaults : undefined;
    return { persona, libraryImages: Array.isArray(imageList) ? imageList.length : null, boundAccounts: defaults ?? null };
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
  list_faces: ListFacesShape,
  list_images: personaRefShape(ListPersonaImagesShape),
  add_image: personaRefShape(AddPersonaImageShape),
  update_image: UpdatePersonaImageShape,
  remove_image: RemovePersonaImageShape,
};

export function registerPersonaMediaTools(server: McpServer, client: PostEngineerClient, remote: boolean): void {
  // add_image reads a local file: only the stdio server offers it.
  const options: ActionOptions<typeof MEDIA_SPECS> = remote ? { unavailable: ['add_image'] } : {};
  const offered = offeredSpecs(MEDIA_SPECS, options);
  server.tool(
    'persona_media',
    actionDescription(
      `A persona's face and image library. list_faces: the stock faces to pick an avatar from (id, url, description). list_images${remote ? '' : ' / add_image (reads a local file)'} / update_image / remove_image: the library images used for the per-video image selection.`,
      offered,
    ),
    actionShape(offered),
    DESTRUCTIVE,
    byAction(
      {
        list_faces: async () => handleListFaces(client),
        list_images: (args) => withPersona(client, args, (resolved) => handleListPersonaImages(client, resolved)),
        add_image: (args) => withPersona(client, args, (resolved) => handleAddPersonaImage(client, resolved)),
        update_image: async (args) => handleUpdatePersonaImage(client, args),
        remove_image: async (args) => handleRemovePersonaImage(client, args),
      },
      MEDIA_SPECS,
      'persona_media',
      options,
    ),
  );
}
