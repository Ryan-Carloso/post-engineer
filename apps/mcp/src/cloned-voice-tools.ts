import { z } from 'zod';

import type { PostEngineerClient } from './client.js';
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
 * The SDK strips unknown keys before the handler runs, so a smuggled
 * audioPath is dropped (never read), not loudly rejected; the strict
 * re-parse is defense-in-depth for direct handler callers only. */
export const CreateClonedVoiceRemoteShape = {
  audioUrl: z
    .string()
    .url()
    .optional()
    .describe(
      `HTTPS URL of a short reference recording (MP3, WAV, M4A, or WebM, max ${MAX_CLONE_AUDIO_MB}MB). Required: the remote server cannot read local files.`,
    ),
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
