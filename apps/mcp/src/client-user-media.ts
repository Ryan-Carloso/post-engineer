import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { PostEngineerClient } from './client.js';
import { parseContractResponse } from './contract-response.js';
import { checkMedia as checkMediaContract, uploadMedia as uploadMediaContract } from './contracts/media.js';
import type { CheckMediaCode, VideoAspect } from './contracts/media.js';
import { MAX_SEGMENT_MEDIA_BYTES, MAX_SEGMENT_MEDIA_MB } from './limits.js';

// The check codes live in the shared media contract; re-exported so
// existing import sites keep working.
export { CHECK_MEDIA_CODES } from './contracts/media.js';
export type { CheckMediaCode } from './contracts/media.js';

//---------------
// Segment media client calls (Phase 2, user media per segment).
// Standalone functions (not client methods) because client.ts is
// grandfathered over the 500-line cap and may not grow — the same
// pattern as client-video-task.ts.
//---------------

// Multipart uploads can legitimately exceed the client's default budget;
// mirrors UPLOAD_TIMEOUT_MS in client.ts (kept as a literal here so
// client.ts stays untouched).
const UPLOAD_TIMEOUT_MS = 120_000;

/**
 * Real image type from magic bytes — the extension is never trusted.
 * Only the types the engine temp_assets flow accepts by suffix (JPG,
 * PNG, WebP): the web route re-validates authoritatively with its own
 * magic-byte check, so a drift here can only fail fast, never smuggle
 * a bad file through.
 */
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

/**
 * Read one local image with the stat-before-read, size-guard-before-and-
 * after-read pattern of the persona library uploads (8MB engine photo
 * limit) and sniff its real type. Shared by the segment upload and the
 * publish_existing image path, so both read local files the same way.
 */
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

/**
 * Upload one local image for a segment and return its mediaId.
 * Only the mediaId reaches tool output: the local path and the temp
 * asset URL never do.
 */
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
      // No JSON content type: fetch sets the multipart boundary itself.
      headers: client.getHeaders(false),
      body: formData,
    },
    'upload segment media',
    UPLOAD_TIMEOUT_MS,
  );
  const parsed = parseContractResponse(uploadMediaContract, result);
  return { mediaId: parsed.mediaId };
}

/**
 * Mechanically check one image URL through the engine (no LLM, no
 * relevance judgement): the agent, who sees the image, decides
 * relevance. Returns exactly one code plus the probed dimensions when
 * the engine measured them, plus has_face when the engine reported it
 * (whether a detectable face is in the photo, or null when there is no
 * file to check or the detector is unavailable — issue #589); the URL
 * never reaches output. With a video aspect given, a photo that cannot
 * fill the frame returns wrong_aspect instead of ok.
 */
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
  // has_face is lenient by design (issue #589): a non-boolean value is
  // dropped (older engines omit the key entirely), never an error.
  if (checked.has_face === true || checked.has_face === false || checked.has_face === null) {
    narrowed.has_face = checked.has_face;
  }
  return narrowed;
}
