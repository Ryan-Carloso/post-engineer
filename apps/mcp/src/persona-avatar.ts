import { basename } from 'node:path';

import { z } from 'zod';

import { readBoundedRegularFile } from './bounded-file-read.js';
import { getErrorMessage, ImageTooLargeError } from './errors.js';
import { mimeTypeForImagePath } from './image-guards.js';
import { MAX_LIBRARY_IMAGE_BYTES, MAX_LIBRARY_IMAGE_MB } from './limits.js';

export async function imageFormFile(path: string): Promise<Blob> {
  const mimeType = mimeTypeForImagePath(path);
  let read;
  try {
    read = await readBoundedRegularFile(path, MAX_LIBRARY_IMAGE_BYTES);
  } catch (error) {
    throw new Error(`Failed to read image "${path}": ${getErrorMessage(error)}`);
  }
  if (read.status === 'not-file') throw new Error(`Image "${path}" is not a regular file.`);
  if (read.status === 'too-large') throw new ImageTooLargeError(path, read.sizeBytes);
  if (read.buffer.length === 0) {
    throw new Error(`Image "${path}" is empty.`);
  }
  return new Blob([read.buffer], { type: mimeType });
}

const AVATAR_PATH_DESCRIPTION = `Local file path to the persona face photo (JPG/JPEG, PNG, or WebP, max ${MAX_LIBRARY_IMAGE_MB}MB), uploaded directly. Use instead of avatarUrl for your own photo.`;

export const CreatePersonaAvatarFields = {
  avatarUrl: z
    .string()
    .url()
    .optional()
    .describe(
      'Public URL to the persona avatar image (use persona_media (action: list_faces) for stock face URLs). Give exactly one of avatarUrl or avatarPath: every persona has a face; "no face" is chosen per video with generate_video options.videoType: \'faceless\'.',
    ),
  avatarPath: z.string().min(1).optional().describe(AVATAR_PATH_DESCRIPTION),
};

export const UpdatePersonaAvatarFields = {
  avatarUrl: z.string().url().optional().describe('New public avatar image URL'),
  avatarPath: z.string().min(1).optional().describe(`New face photo. ${AVATAR_PATH_DESCRIPTION}`),
};

export function refinePersonaAvatar(required: boolean) {
  return (value: PersonaAvatarInput, ctx: z.RefinementCtx): void => {
    const count = [value.avatarUrl, value.avatarPath].filter(provided).length;
    if (count > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['avatarPath'], message: 'Give either avatarUrl or avatarPath, not both.' });
    } else if (required && count === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['avatarUrl'], message: 'avatarUrl or avatarPath is required: every persona has a face.' });
    }
  };
}

export interface PersonaAvatarInput {
  avatarUrl?: string | null;
  avatarPath?: string | null;
}

function provided(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && value.length > 0;
}

export async function appendPersonaAvatar(
  formData: FormData,
  input: PersonaAvatarInput,
  required: boolean,
): Promise<void> {
  const { avatarUrl, avatarPath } = input;
  if (provided(avatarUrl) && provided(avatarPath)) {
    throw new Error('Give either avatarUrl or avatarPath, not both.');
  }
  if (provided(avatarUrl)) {
    formData.set('avatarUrl', avatarUrl);
    return;
  }
  if (provided(avatarPath)) {
    formData.set('photo', await imageFormFile(avatarPath), basename(avatarPath));
    return;
  }
  if (required) {
    throw new Error(
      'avatarUrl or avatarPath is required: every persona has a face. Use persona_media (action: list_faces) for a stock face URL, avatarPath for a local photo, and generate_video options.videoType: \'faceless\' for videos without a face.',
    );
  }
}
