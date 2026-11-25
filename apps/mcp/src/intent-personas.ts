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
import { AddPersonaImageRemoteShape } from './remote-shapes-images.js';
import { DESTRUCTIVE } from './tool-annotations.js';
import { AddPersonaImageRemoteSchema, handleAddPersonaImageFromUrl } from './tools-persona-image-url.js';
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

export function personasDescription(remote: boolean): string {
  const face = remote ? 'avatarUrl (a public URL or a url from persona_media (action: list_faces))' : 'avatarUrl or avatarPath (a local photo, uploaded directly)';
  return actionDescription(
    `Manage your personas (the on-camera presenter, voice and defaults). list: names and ids. get: one persona with its image count and bound publishing accounts. create: a face is REQUIRED (${face}) and at least one publishing account (accounts); a voiceover video is chosen per video, not per persona. update: only the given fields change (identityCard sets or, with null, removes the identity card; see persona_media get_card and render_prompt). delete: preview first, then confirm with the token.`,
    offeredSpecs(PERSONAS_SPECS, personasOptions(remote)),
  );
}

async function getPersona(client: PostEngineerClient, args: { personaId: string }): Promise<McpToolResponse> {
  return handleLibraryCall(async () => {
    const [listing, images, publishing] = await Promise.all([
      client.listPersonas(),
      client.listPersonaImages(args.personaId).catch((error) => {
        if (error instanceof MalformedContractResponseError) return undefined;
        throw error;
      }),
      getPersonaPublishingAccounts(client, args.personaId).catch((error) => {
        if (error instanceof MalformedContractResponseError) return undefined;
        throw error;
      }),
    ]);
    const persona = listing.personas.find((entry) => entry.id === args.personaId);
    if (persona === undefined) throw new Error(`No persona with id ${args.personaId}. Call personas with action "list" to see them.`);
    return { persona, libraryImages: images?.images.length ?? null, boundAccounts: publishing?.defaults ?? null };
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
  get_card: personaRefShape(GetCardShape),
  render_prompt: personaRefShape(RenderPromptShape),
};

export function registerPersonaMediaTools(server: McpServer, client: PostEngineerClient, remote: boolean): void {
  const options: ActionOptions<typeof MEDIA_SPECS> = remote ? { variants: { add_image: personaRefShape(AddPersonaImageRemoteShape) } } : {};
  const offered = offeredSpecs(MEDIA_SPECS, options);
  server.tool(
    'persona_media',
    actionDescription(
      `A persona's face and image library. list_faces: the stock faces to pick an avatar from (id, url, description). list_images / add_image (${remote ? 'downloads a public https imageUrl' : 'reads a local file'}) / update_image / remove_image: the library images used for the per-video image selection. get_card: the persona's identity card (set with personas update identityCard), or null. render_prompt: renders a deterministic image-edit prompt from the card plus a scene (outfit, pose, setting, lighting, framing) and returns { prompt, suggestedDescription }; it is advice for YOUR image tool, nothing is generated or stored. Workflow: render_prompt, make the image with your own tool using the persona's base photo as the reference, add_image with description = suggestedDescription, then use the new photos in generate_video options.lipsyncPhotos for full_lipsync. The card describes a real person's physical traits: nude or sexualised clothing is rejected, and the server cannot police what your image tool makes.`,
      offered,
    ),
    actionShape(offered),
    DESTRUCTIVE,
    byAction(
      {
        list_faces: async () => handleListFaces(client),
        list_images: (args) => withPersona(client, args, (resolved) => handleListPersonaImages(client, resolved)),
        add_image: (args) => withPersona(client, args, (resolved) => (remote ? handleAddPersonaImageFromUrl(client, AddPersonaImageRemoteSchema.parse(resolved)) : handleAddPersonaImage(client, resolved))),
        update_image: async (args) => handleUpdatePersonaImage(client, args),
        remove_image: async (args) => handleRemovePersonaImage(client, args),
        get_card: (args) => withPersona(client, args, (resolved) => handleGetPersonaCard(client, resolved)),
        render_prompt: (args) => withPersona(client, args, (resolved) => handleRenderPersonaPrompt(client, resolved)),
      },
      MEDIA_SPECS,
      'persona_media',
      options,
    ),
  );
}
