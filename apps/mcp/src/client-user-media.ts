import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { PostEngineerClient } from './client.js';
import { parseContractResponse } from './contract-response.js';
import { checkMedia as checkMediaContract, uploadMedia as uploadMediaContract } from './contracts/media.js';
import type { CheckMediaCode, VideoAspect } from './contracts/media.js';
import { MAX_SEGMENT_MEDIA_BYTES, MAX_SEGMENT_MEDIA_MB } from './limits.js';

export { CHECK_MEDIA_CODES } from './contracts/media.js';
export type { CheckMediaCode } from './contracts/media.js';

const UPLOAD_TIMEOUT_MS = 120_000;

export function detectSegmentImageMimeType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function assertSegmentMediaSize(sizeBytes: number, path: string): void {
  if (sizeBytes > MAX_SEGMENT_MEDIA_BYTES) {
    throw new Error(
      `Image "${basename(path)}" is too large (${sizeBytes} bytes; max ${MAX_SEGMENT_MEDIA_MB}MB).`,
    );
  }
}

export async function readLocalImage(path: string): Promise<{ buffer: Buffer; mimeType: string }> {
  let fileStat;
  try {
    fileStat = await stat(path);
  } catch {
    throw new Error(`Failed to read image "${basename(path)}".`);
  }
  assertSegmentMediaSize(fileStat.size, path);
  let buffer: Buffer;
  try {
    buffer = await readFile(path);
  } catch {
    throw new Error(`Failed to read image "${basename(path)}".`);
  }
  if (buffer.length === 0) {
    throw new Error(`Image "${basename(path)}" is empty.`);
  }
  assertSegmentMediaSize(buffer.length, path);
  const mimeType = detectSegmentImageMimeType(buffer);
  if (mimeType === null) {
    throw new Error(
      `Image "${basename(path)}" is not a JPG, PNG, or WebP image (real content, not extension).`,
    );
  }
  return { buffer, mimeType };
}

export async function uploadSegmentMedia(
  client: PostEngineerClient,
  path: string,
): Promise<{ mediaId: string }> {
  const { buffer, mimeType } = await readLocalImage(path);
  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: mimeType }), basename(path));
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
