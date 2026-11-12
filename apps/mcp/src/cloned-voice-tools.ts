import { z } from 'zod';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PostEngineerClient } from './client.js';
import { withTracking } from './analytics.js';
import {
  createClonedVoiceFromFile,
  createClonedVoiceFromUrl,
  deleteClonedVoice,
  getClonedVoice,
  listClonedVoices,
  previewClonedVoice,
  previewHouseVoice,
} from './cloned-voice-client.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';
import { isEnglishLanguage, ONLY_ENGLISH_CLONE_MESSAGE } from './language.js';
import {
  CLONE_PREVIEW_TEXT_MAX_CHARS,
  HOUSE_PREVIEW_TEXT_MAX_CHARS,
  MAX_CLONE_AUDIO_MB,
} from './limits.js';

export const ListClonedVoicesShape = {};

export const ListClonedVoicesSchema = z.object(ListClonedVoicesShape);

export const CreateClonedVoiceShape = {
  audioUrl: z
    .string()
    .url()
    .optional()
    .describe(
      `HTTPS URL of a short reference recording (MP3, WAV, M4A, or WebM, max ${MAX_CLONE_AUDIO_MB}MB). Send exactly one of audioUrl or audioPath.`,
    ),
  audioPath: z
    .string()
    .min(1)
    .optional()
    .describe(
      `Local file path of a short reference recording on this computer (.mp3, .wav, .m4a, or .webm, max ${MAX_CLONE_AUDIO_MB}MB). Send exactly one of audioUrl or audioPath.`,
    ),
  language: z
    .string()
    .min(1)
    .refine(isEnglishLanguage, { message: ONLY_ENGLISH_CLONE_MESSAGE })
    .describe('Language code for the clone — English only for now (e.g. en, en-us)'),
  consent: z.literal(true).describe('Must be true: caller confirms consent to voice cloning'),
  denoise: z
    .boolean()
    .describe('Clean background noise from the recording before cloning (recommended true; false for studio audio)'),
};

export const CREATE_CLONE_AUDIO_SOURCE_MESSAGE = 'Send exactly one of audioUrl or audioPath.';

// The tool registers the raw shape (no object-level refine), so the handler
// re-parses with this schema to enforce exactly one audio source.
export const CreateClonedVoiceSchema = z
  .object(CreateClonedVoiceShape)
  .refine((args) => (args.audioUrl === undefined) !== (args.audioPath === undefined), {
    message: CREATE_CLONE_AUDIO_SOURCE_MESSAGE,
  });

/** create_cloned_voice over HTTP: audioUrl only — a local audioPath would
 * resolve on the MCP server's filesystem, not on the agent's machine.
 * Strict so a smuggled audioPath fails loudly instead of being dropped. */
export const CreateClonedVoiceRemoteShape = {
  audioUrl: CreateClonedVoiceShape.audioUrl,
  language: CreateClonedVoiceShape.language,
  consent: CreateClonedVoiceShape.consent,
  denoise: CreateClonedVoiceShape.denoise,
};

export const CreateClonedVoiceRemoteSchema = z
  .object(CreateClonedVoiceRemoteShape)
  .strict()
  .refine((args) => args.audioUrl !== undefined, {
    message: 'audioUrl is required: the remote server cannot read local files.',
    path: ['audioUrl'],
  });

export const DeleteClonedVoiceShape = {
  cloneId: z.string().min(1).describe('Cloned voice id from list_cloned_voices'),
};

export const DeleteClonedVoiceSchema = z.object(DeleteClonedVoiceShape);

export const GetClonedVoiceShape = {
  cloneId: z.string().min(1).describe('Cloned voice id (the id returned by create_cloned_voice or list_cloned_voices)'),
};

export const GetClonedVoiceSchema = z.object(GetClonedVoiceShape);

export const PreviewClonedVoiceShape = {
  cloneId: z.string().min(1).describe('Ready cloned voice id'),
  language: z
    .string()
    .refine(isEnglishLanguage, { message: ONLY_ENGLISH_CLONE_MESSAGE })
    .optional()
    .describe('Optional preview language override — English only for now'),
  text: z
    .string()
    .trim()
    .min(1)
    .max(CLONE_PREVIEW_TEXT_MAX_CHARS)
    .optional()
    .describe(
      `Optional words for the clone to speak (1-${CLONE_PREVIEW_TEXT_MAX_CHARS} chars, English). Omit to hear the fixed sample. Previews are free and limited to 10 per user per day.`,
    ),
};

export const PreviewClonedVoiceSchema = z.object(PreviewClonedVoiceShape);

export const PreviewHouseVoiceShape = {
  voiceId: z
    .string()
    .min(1)
    .describe('House voice id from list_voices (e.g. chatterbox:phonon_zoey)'),
  text: z
    .string()
    .trim()
    .min(1)
    .max(HOUSE_PREVIEW_TEXT_MAX_CHARS)
    .optional()
    .describe(
      `Optional words for the house voice to speak (1-${HOUSE_PREVIEW_TEXT_MAX_CHARS} chars, English). Omit to hear the fixed sample. Previews are free and limited to 10 per user per day.`,
    ),
};

export const PreviewHouseVoiceSchema = z.object(PreviewHouseVoiceShape);

export async function handleListClonedVoices(
  client: PostEngineerClient,
): Promise<McpToolResponse> {
  return handleLibraryCall(() => listClonedVoices(client), 'listing cloned voices');
}

export async function handleCreateClonedVoice(
  client: PostEngineerClient,
  rawArgs: z.infer<typeof CreateClonedVoiceSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(
    () => {
      const parsed = CreateClonedVoiceSchema.safeParse(rawArgs);
      if (!parsed.success) {
        throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '));
      }
      const args = parsed.data;
      if (args.audioPath !== undefined) {
        return createClonedVoiceFromFile(client, args.audioPath, args.language, args.consent, args.denoise);
      }
      if (args.audioUrl !== undefined) {
        return createClonedVoiceFromUrl(client, args.audioUrl, args.language, args.consent, args.denoise);
      }
      throw new Error(CREATE_CLONE_AUDIO_SOURCE_MESSAGE);
    },
    'creating cloned voice',
    'Voice clone registration started',
  );
}

export async function handleGetClonedVoice(
  client: PostEngineerClient,
  args: z.infer<typeof GetClonedVoiceSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(() => getClonedVoice(client, args.cloneId), 'getting cloned voice');
}

export async function handleDeleteClonedVoice(
  client: PostEngineerClient,
  args: z.infer<typeof DeleteClonedVoiceSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(
    () => deleteClonedVoice(client, args.cloneId),
    'deleting cloned voice',
    'Cloned voice deleted',
  );
}

export async function handlePreviewClonedVoice(
  client: PostEngineerClient,
  args: z.infer<typeof PreviewClonedVoiceSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(
    () => previewClonedVoice(client, args.cloneId, args.language, args.text),
    'previewing cloned voice',
  );
}

export async function handlePreviewHouseVoice(
  client: PostEngineerClient,
  args: z.infer<typeof PreviewHouseVoiceSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(
    () => previewHouseVoice(client, args.voiceId, args.text),
    'previewing house voice',
  );
}

// Registers the cloned-voice tools (list/create/get/delete/preview, plus the
// house-voice preview) on the server. Kept here, next to their shapes and
// handlers, so index.ts stays under the 500-line cap.
export function registerClonedVoiceTools(server: McpServer, apiClient: PostEngineerClient, remote = false): void {
  server.tool(
    'list_cloned_voices',
    'List per-user Chatterbox voice clones (status, voice_id when ready).',
    ListClonedVoicesShape,
    withTracking('list_cloned_voices', async () => {
      return handleListClonedVoices(apiClient);
    }),
  );

  server.tool(
    'create_cloned_voice',
    remote
      ? 'Register a voice clone from a short HTTPS audio URL (requires explicit consent).'
      : 'Register a voice clone from a short HTTPS audio URL or a local audio file path (requires explicit consent).',
    remote ? CreateClonedVoiceRemoteShape : CreateClonedVoiceShape,
    withTracking('create_cloned_voice', async (args) => {
      return remote
        ? handleCreateClonedVoice(apiClient, CreateClonedVoiceRemoteSchema.parse(args))
        : handleCreateClonedVoice(apiClient, args);
    }),
  );

  server.tool(
    'get_cloned_voice',
    'Get one voice clone by id: its status (poll after create_cloned_voice until ready or failed) and voice_id once ready.',
    GetClonedVoiceShape,
    withTracking('get_cloned_voice', async (args) => {
      return handleGetClonedVoice(apiClient, args);
    }),
  );

  server.tool(
    'delete_cloned_voice',
    'Delete one of your voice clones by id.',
    DeleteClonedVoiceShape,
    withTracking('delete_cloned_voice', async (args) => {
      return handleDeleteClonedVoice(apiClient, args);
    }),
  );

  server.tool(
    'preview_cloned_voice',
    'Synthesize a short MP3 preview for a ready voice clone, optionally speaking your own text (returns base64 audio; 10 previews per day).',
    PreviewClonedVoiceShape,
    withTracking('preview_cloned_voice', async (args) => {
      return handlePreviewClonedVoice(apiClient, args);
    }),
  );

  server.tool(
    'preview_house_voice',
    'Synthesize a short MP3 preview for a house voice, optionally speaking your own text (returns base64 audio; 10 previews per day).',
    PreviewHouseVoiceShape,
    withTracking('preview_house_voice', async (args) => {
      return handlePreviewHouseVoice(apiClient, args);
    }),
  );
}
