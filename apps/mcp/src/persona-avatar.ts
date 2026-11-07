// Persona face sources for create_persona and update_persona: a public
// image URL (avatarUrl) or a local image file (avatarPath). The file goes
// up as the multipart `photo` field, the same field the web form uses, so
// the face never depends on the server downloading a link. Extracted from
// client.ts and tools.ts so both stay under the file-size ratchet.
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

import { z } from 'zod';

import { getErrorMessage, ImageTooLargeError } from './errors.js';
import { assertImageSize, mimeTypeForImagePath } from './image-guards.js';
import { MAX_LIBRARY_IMAGE_MB } from './limits.js';

export async function imageFormFile(path: string): Promise<Blob> {
  // Validate before uploading: the API rejects the file anyway, so an
  // oversized or unsupported image fails fast locally instead of wasting an
  // upload. A stat() pre-check bounds memory before readFile — a multi-GB
  // file misnamed .png would otherwise load fully into this stdio process.
  // The TOCTOU window is benign: the authoritative size check still runs on
  // the buffer after read. Any failure surfaces with the full path for a
  // consistent, actionable message.
  // Note: the extension is trusted as a hint only; the server re-validates
  // content via magic bytes, so a mislabeled file still fails server-side
  // (duplicating magic-byte sniffing locally would be a second source of
  // truth that can drift).
  const mimeType = mimeTypeForImagePath(path);
  try {
    const fileStat = await stat(path);
    assertImageSize(fileStat.size, path);
  } catch (error) {
    // Discriminate by type, not by message text: the typed size error
    // passes through untouched, while stat failures become the actionable
    // "Failed to read image" wrapper.
    if (error instanceof ImageTooLargeError) throw error;
    throw new Error(`Failed to read image "${path}": ${getErrorMessage(error)}`);
  }
  let buffer: Buffer;
  try {
    buffer = await readFile(path);
  } catch (error) {
    throw new Error(`Failed to read image "${path}": ${getErrorMessage(error)}`);
  }
  if (buffer.length === 0) {
    // A 0-byte file would pass the local gate but shift the index-aligned
    // imageTags/imageDescriptions (the server 400s when the tag/description
    // counts don't match the file count), so reject it here with a clear
    // message instead of a confusing server 400.
    throw new Error(`Image "${path}" is empty.`);
  }
  // The post-read check reuses the shared guard: same limit, same message,
  // full path — and it covers the (benign) TOCTOU window after stat.
  assertImageSize(buffer.length, path);
  return new Blob([buffer], { type: mimeType });
}

const AVATAR_PATH_DESCRIPTION = `Local file path to the persona face photo (JPG/JPEG, PNG, or WebP, max ${MAX_LIBRARY_IMAGE_MB}MB), uploaded directly. Use instead of avatarUrl for your own photo.`;

/** create_persona: exactly one of avatarUrl or avatarPath (checked in the client). */
export const CreatePersonaAvatarFields = {
  avatarUrl: z
    .string()
    .url()
    .optional()
    .describe(
      'Public URL to the persona avatar image (use list_faces for stock face URLs). Give exactly one of avatarUrl or avatarPath: every persona has a face; "no face" is chosen per video with generate_persona_video options.faceless.',
    ),
  avatarPath: z.string().min(1).optional().describe(AVATAR_PATH_DESCRIPTION),
};

/** update_persona: at most one of avatarUrl or avatarPath. */
export const UpdatePersonaAvatarFields = {
  // No .nullable(): the API has no "clear avatar" sentinel — null would be silently ignored.
  avatarUrl: z.string().url().optional().describe('New public avatar image URL'),
  avatarPath: z.string().min(1).optional().describe(`New face photo. ${AVATAR_PATH_DESCRIPTION}`),
};

/**
 * Full-schema refine for the handler re-parse (the SDK validates the raw
 * shape only): a face from exactly one source (create) or at most one
 * (update) fails as a schema error before any file read or fetch.
 */
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

// Programmatic callers can pass null; only a non-empty string is a face.
function provided(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && value.length > 0;
}

/**
 * Appends the persona face to the form: `avatarUrl` as text or
 * `avatarPath` as the `photo` file. Both at once is a conflict the server
 * would resolve silently (the photo wins on PATCH), so it fails here before
 * any file read. `required` makes a missing face an error (create).
 */
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
      'avatarUrl or avatarPath is required: every persona has a face. Use list_faces for a stock face URL, avatarPath for a local photo, and generate_persona_video options.faceless for videos without a face.',
    );
  }
}
