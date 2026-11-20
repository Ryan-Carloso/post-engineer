import { basename } from 'node:path';
import { readBoundedRegularFile } from './bounded-file-read.js';
import type { PostEngineerClient } from './client.js';
import { parseContractResponse } from './contract-response.js';
import { checkMedia as checkMediaContract, uploadMedia as uploadMediaContract } from './contracts/media.js';
import type { CheckMediaCode, VideoAspect } from './contracts/media.js';
import { detectSegmentImageMimeType } from './image-mime.js';
import { MAX_SEGMENT_MEDIA_BYTES, MAX_SEGMENT_MEDIA_MB } from './limits.js';
import type { HostLookup } from './public-fetch.js';
import { fetchRemoteImage } from './remote-image-fetch.js';

export { CHECK_MEDIA_CODES } from './contracts/media.js';
export type { CheckMediaCode } from './contracts/media.js';

const UPLOAD_TIMEOUT_MS = 120_000;

export async function readLocalImage(path: string): Promise<{ buffer: Buffer; mimeType: string }> {
  let read;
  try {
    read = await readBoundedRegularFile(path, MAX_SEGMENT_MEDIA_BYTES);
  } catch {
    throw new Error(`Failed to read image "${basename(path)}".`);
  }
  if (read.status === 'not-file') {
    throw new Error(`Image "${basename(path)}" is not a regular file.`);
  }
  if (read.status === 'too-large') {
    throw new Error(
      `Image "${basename(path)}" is too large (${read.sizeBytes} bytes; max ${MAX_SEGMENT_MEDIA_MB}MB).`,
    );
  }
  const { buffer } = read;
  if (buffer.length === 0) {
    throw new Error(`Image "${basename(path)}" is empty.`);
  }
  const mimeType = detectSegmentImageMimeType(buffer);
  if (mimeType === null) {
    throw new Error(
      `Image "${basename(path)}" is not a JPG, PNG, or WebP image (real content, not extension).`,
    );
  }
  return { buffer, mimeType };
}

async function postSegmentMedia(
  client: PostEngineerClient,
  image: { buffer: Buffer; mimeType: string; filename: string },
): Promise<{ mediaId: string }> {
  const formData = new FormData();
  formData.append('file', new Blob([image.buffer], { type: image.mimeType }), image.filename);
  const result = await client.request(
    '/api/media/upload',
    {
      method: 'POST',
      headers: client.getHeaders(false),
      body: formData,
    },
    'upload segment media',
    UPLOAD_TIMEOUT_MS,
  );
  const parsed = parseContractResponse(uploadMediaContract, result);
  return { mediaId: parsed.mediaId };
}

export async function uploadSegmentMedia(
  client: PostEngineerClient,
  path: string,
): Promise<{ mediaId: string }> {
  const { buffer, mimeType } = await readLocalImage(path);
  return postSegmentMedia(client, { buffer, mimeType, filename: basename(path) });
}

export async function uploadSegmentMediaFromUrl(
  client: PostEngineerClient,
  imageUrl: string,
  lookup?: HostLookup,
): Promise<{ mediaId: string }> {
  return postSegmentMedia(client, await fetchRemoteImage(imageUrl, { maxBytes: MAX_SEGMENT_MEDIA_BYTES, lookup }));
}

export async function checkSegmentMedia(
  client: PostEngineerClient,
  url: string,
  videoAspect?: VideoAspect,
): Promise<{ code: CheckMediaCode; width?: number; height?: number; has_face?: boolean | null }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('url must be an http(s) URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('url must be an http(s) URL.');
  }
  const result = await client.request(
    '/api/media/check',
    {
      method: 'POST',
      headers: client.getHeaders(),
      body: JSON.stringify(
        videoAspect === undefined ? { url } : { url, videoAspect },
      ),
    },
    'check segment media',
  );
  const checked = parseContractResponse(checkMediaContract, result);
  const narrowed: { code: CheckMediaCode; width?: number; height?: number; has_face?: boolean | null } = { code: checked.code };
  if (checked.width !== undefined) narrowed.width = checked.width;
  if (checked.height !== undefined) narrowed.height = checked.height;
  if (checked.has_face === true || checked.has_face === false || checked.has_face === null) {
    narrowed.has_face = checked.has_face;
  }
  return narrowed;
}
