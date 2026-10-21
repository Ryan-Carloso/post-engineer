import { z } from 'zod';

import type { PostEngineerClient } from './client.js';
import {
  createClonedVoiceFromUrl,
  deleteClonedVoice,
  listClonedVoices,
  previewClonedVoice,
} from './cloned-voice-client.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';
import { isEnglishLanguage, ONLY_ENGLISH_CLONE_MESSAGE } from './language.js';

export const ListClonedVoicesShape = {};

export const ListClonedVoicesSchema = z.object(ListClonedVoicesShape);

export const CreateClonedVoiceShape = {
  audioUrl: z.string().url().describe('HTTPS URL of a short reference recording (MP3, WAV, M4A, or WebM, max 20MB)'),
  language: z
    .string()
    .min(1)
    .refine(isEnglishLanguage, { message: ONLY_ENGLISH_CLONE_MESSAGE })
    .describe('Language code for the clone — English only for now (e.g. en, en-us)'),
  consent: z.literal(true).describe('Must be true: caller confirms consent to voice cloning'),
};

export const CreateClonedVoiceSchema = z.object(CreateClonedVoiceShape);

export const DeleteClonedVoiceShape = {
  cloneId: z.string().min(1).describe('Cloned voice id from list_cloned_voices'),
};

export const DeleteClonedVoiceSchema = z.object(DeleteClonedVoiceShape);

export const PreviewClonedVoiceShape = {
  cloneId: z.string().min(1).describe('Ready cloned voice id'),
  language: z.string().optional().describe('Optional preview language override'),
};

export const PreviewClonedVoiceSchema = z.object(PreviewClonedVoiceShape);

export async function handleListClonedVoices(
  client: PostEngineerClient,
): Promise<McpToolResponse> {
  return handleLibraryCall(() => listClonedVoices(client), 'listing cloned voices');
}

export async function handleCreateClonedVoice(
  client: PostEngineerClient,
  args: z.infer<typeof CreateClonedVoiceSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(
    () => createClonedVoiceFromUrl(client, args.audioUrl, args.language, args.consent),
    'creating cloned voice',
    'Voice clone registration started',
  );
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
    () => previewClonedVoice(client, args.cloneId, args.language),
    'previewing cloned voice',
  );
}
