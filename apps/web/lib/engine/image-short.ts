import 'server-only';

import { UploadError, ValidationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { engineAuthHeaders } from '@/lib/request-auth';
import { isImageUploadContentType } from '@/lib/contracts/upload-types';

export const IMAGE_SHORT_TIMEOUT_MS = 180_000;
export const IMAGE_SHORT_FILE_NAME = 'image-short.mp4';

const CLIENT_ERROR_CODES: ReadonlySet<string> = new Set(['invalid_image', 'image_too_large']);

function engineErrorCode(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('body' in payload)) return null;
  const body = payload.body;
  if (typeof body !== 'object' || body === null || !('code' in body)) return null;
  return typeof body.code === 'string' ? body.code : null;
}

export function isImageForShort(file: File): boolean {
  return isImageUploadContentType(file.type);
}

export async function renderImageShort(
  image: File,
  userId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<File> {
  const baseUrl = process.env.MONEYPRINT_API_URL;
  if (!baseUrl) {
    throw new Error('MONEYPRINT_API_URL is not defined');
  }
  const form = new FormData();
  form.append('file', image, image.name);
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/v1/media/image-short`, {
      method: 'POST',
      headers: engineAuthHeaders(userId),
      body: form,
      signal: AbortSignal.timeout(IMAGE_SHORT_TIMEOUT_MS),
    });
  } catch (error) {
    logger.error('[image-short] engine request failed', error, { userId });
    throw new UploadError('Could not turn the image into a YouTube Short', 'processing');
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const code = engineErrorCode(payload);
    if (code !== null && CLIENT_ERROR_CODES.has(code)) {
      throw new ValidationError(
        code === 'image_too_large' ? 'Image is too large. Maximum is 8 MB.' : 'The image could not be read. Use a JPEG or PNG.',
        'video',
      );
    }
    logger.error('[image-short] engine render failed', new Error(`engine answered ${response.status}`), {
      userId,
      metadata: { status: response.status, code },
    });
    throw new UploadError('Could not turn the image into a YouTube Short', 'processing');
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('video/mp4')) {
    logger.error('[image-short] engine answered a non-video body', new Error(`content-type ${contentType}`), { userId });
    throw new UploadError('Could not turn the image into a YouTube Short', 'processing');
  }
  const video = await response.arrayBuffer();
  return new File([video], IMAGE_SHORT_FILE_NAME, { type: 'video/mp4' });
}
