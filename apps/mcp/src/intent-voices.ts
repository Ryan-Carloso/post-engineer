import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { actionDescription, actionShape, byAction, offeredSpecs, type ActionOptions } from './action-tool.js';
import type { PostEngineerClient } from './client.js';
import {
  CreateClonedVoiceRemoteSchema,
  CreateClonedVoiceRemoteShape,
  CreateClonedVoiceSchema,
  CreateClonedVoiceShape,
  DeleteClonedVoiceShape,
  GetClonedVoiceShape,
  ListClonedVoicesShape,
  PreviewClonedVoiceShape,
  PreviewHouseVoiceShape,
  handleCreateClonedVoice,
  handleDeleteClonedVoice,
  handleGetClonedVoice,
  handleListClonedVoices,
  handlePreviewClonedVoice,
  handlePreviewHouseVoice,
} from './cloned-voice-tools.js';
import { DESTRUCTIVE } from './tool-annotations.js';
import { ListVoicesShape, handleListVoices } from './tools.js';

//---------------
// voices (issue #566): the house voices and the voice clones of the account.
// create_clone from a local audio file exists only on the stdio server; the
// remote server takes an HTTPS audioUrl.
//---------------

const VOICES_SPECS = {
  list: ListVoicesShape,
  preview: PreviewHouseVoiceShape,
  list_clones: ListClonedVoicesShape,
  create_clone: CreateClonedVoiceShape,
  get_clone: GetClonedVoiceShape,
  preview_clone: PreviewClonedVoiceShape,
  delete_clone: DeleteClonedVoiceShape,
};

export function registerVoiceTools(server: McpServer, client: PostEngineerClient, remote: boolean): void {
  // The remote create_clone takes audioUrl only (a path would resolve on the server).
  const options: ActionOptions<typeof VOICES_SPECS> = remote ? { variants: { create_clone: CreateClonedVoiceRemoteShape } } : {};
  const offered = offeredSpecs(VOICES_SPECS, options);
  server.tool(
    'voices',
    actionDescription(
      `Voices for personas and videos. list: the 65 English house voices, each with a text description plus gender/accent/kind (filter with gender, origin, search such as "deep calm"); the voiceId of a persona or video is one of these ids, a label, or a ready clone. preview: a short MP3 of a house voice, optionally with your own text (10 previews a day). Clones: list_clones, create_clone (${remote ? 'from an HTTPS audioUrl' : 'from an HTTPS audioUrl or a local audioPath'}; needs explicit consent), get_clone (poll until ready), preview_clone, delete_clone.`,
      offered,
    ),
    actionShape(offered),
    DESTRUCTIVE,
    byAction(
      {
        list: async (args) => handleListVoices(client, args),
        preview: async (args) => handlePreviewHouseVoice(client, args),
        list_clones: async () => handleListClonedVoices(client),
        create_clone: async (args) => handleCreateClonedVoice(client, remote ? CreateClonedVoiceRemoteSchema.parse(args) : CreateClonedVoiceSchema.parse(args)),
        get_clone: async (args) => handleGetClonedVoice(client, args),
        preview_clone: async (args) => handlePreviewClonedVoice(client, args),
        delete_clone: async (args) => handleDeleteClonedVoice(client, args),
      },
      VOICES_SPECS,
      'voices',
      options,
    ),
  );
}
