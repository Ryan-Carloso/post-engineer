import { basename } from 'node:path';

import { z } from 'zod';

import { readBoundedRegularFile } from './bounded-file-read.js';
import { getErrorMessage, ImageTooLargeError } from './errors.js';
import { mimeTypeForImagePath } from './image-guards.js';
import { MAX_PERSONA_PHOTO_BYTES, MAX_PERSONA_PHOTO_MB } from './limits.js';

async function imageFormFile(path: string): Promise<Blob> {
  const mimeType = mimeTypeForImagePath(path);
  let read;
  try {
    read = await readBoundedRegularFile(path, MAX_PERSONA_PHOTO_BYTES);
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

export const PersonaAvatarFields = {
  avatarPath: z
    .string()
    .min(1)
    .optional()
    .describe(`Local file path to the persona photo shown on the persona card (JPG/JPEG, PNG, or WebP, max ${MAX_PERSONA_PHOTO_MB}MB), uploaded directly. Optional.`),
};

export interface PersonaAvatarInput {
  avatarPath?: string | null;
}

export async function appendPersonaAvatar(formData: FormData, input: PersonaAvatarInput): Promise<void> {
  const { avatarPath } = input;
  if (avatarPath !== undefined && avatarPath !== null && avatarPath.length > 0) {
    formData.set('photo', await imageFormFile(avatarPath), basename(avatarPath));
  }
}
