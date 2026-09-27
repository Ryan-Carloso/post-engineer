import { z } from 'zod';
import { detectMagicMimeType } from '@/lib/media/magic-bytes';
import type { MediaUploadErrorCode, MediaUploadIssue } from '@/lib/types';

//---------------
// Upload Schema — media upload validation with Zod.
// Rules: file present, non-empty, up to 100MB, allowed formats,
// and real content (magic bytes) matching the declared type.
// Failures produce stable codes (MediaUploadErrorCode) — translation
// for the user lives in the frontend (lib/i18n).
//---------------

export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

// Formats accepted on upload: MP4/MOV videos and JPEG/PNG images.
// Instagram Content Publishing only accepts MP4 and JPEG; conversion
// happens in the handler when needed.
export const ALLOWED_TYPES = [
  'video/mp4',
  'video/quicktime',
  'image/jpeg',
  'image/png',
];

export const ALLOWED_EXTENSIONS = '.mp4,.mov,.jpg,.jpeg,.png';

export const ALLOWED_TYPES_SET = new Set(ALLOWED_TYPES);

const MEDIA_UPLOAD_ERROR_CODES: readonly MediaUploadErrorCode[] = [
  'FILE_REQUIRED',
  'FILE_EMPTY',
  'FILE_TOO_LARGE',
  'FORMAT_NOT_ALLOWED',
  'CONTENT_UNRECOGNIZED',
  'TYPE_MISMATCH',
];

function isMediaUploadErrorCode(value: string): value is MediaUploadErrorCode {
  return MEDIA_UPLOAD_ERROR_CODES.includes(value as MediaUploadErrorCode);
}

const mediaUploadSchema = z
  .object({
    file: z.instanceof(File, { message: 'FILE_REQUIRED' }),
    buffer: z.instanceof(Buffer),
  })
  .superRefine(({ file, buffer }, ctx) => {
    if (file.size === 0) {
      ctx.addIssue({ code: 'custom', path: ['file'], message: 'FILE_EMPTY' });
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      ctx.addIssue({ code: 'custom', path: ['file'], message: 'FILE_TOO_LARGE' });
      return;
    }

    const declaredType = file.type;

    if (!ALLOWED_TYPES.includes(declaredType)) {
      ctx.addIssue({ code: 'custom', path: ['file'], message: 'FORMAT_NOT_ALLOWED' });
      return;
    }

    // Magic bytes: the content must match the declared type
    const detectedType = detectMagicMimeType(buffer);

    if (!detectedType) {
      ctx.addIssue({ code: 'custom', path: ['file'], message: 'CONTENT_UNRECOGNIZED' });
      return;
    }

    if (detectedType !== declaredType) {
      ctx.addIssue({ code: 'custom', path: ['file'], message: 'TYPE_MISMATCH' });
    }
  });

//---------------
// parseMediaUpload — validates { file, buffer }.
// Returns the validated data or the list of issues (stable codes).
//---------------

export type MediaUploadParseResult =
  | { success: true; file: File; buffer: Buffer; detectedType: string }
  | { success: false; issues: MediaUploadIssue[] };

export function parseMediaUpload(
  input: unknown,
  buffer: Buffer
): MediaUploadParseResult {
  const parsed = mediaUploadSchema.safeParse({ file: input, buffer });

  if (!parsed.success) {
    const issues: MediaUploadIssue[] = parsed.error.issues.map((issue) => ({
      field: issue.path.join('.') || 'file',
      code: isMediaUploadErrorCode(issue.message) ? issue.message : 'FILE_REQUIRED',
    }));
    return { success: false, issues };
  }

  const { file: validatedFile, buffer: validatedBuffer } = parsed.data;
  const detectedType = detectMagicMimeType(validatedBuffer);

  return {
    success: true,
    file: validatedFile,
    buffer: validatedBuffer,
    detectedType: detectedType ?? validatedFile.type,
  };
}
