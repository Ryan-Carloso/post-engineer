import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { PostEngineerClient } from './client.js';
import { MAX_SEGMENT_MEDIA_BYTES, MAX_SEGMENT_MEDIA_MB } from './limits.js';

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

export const CHECK_MEDIA_CODES = [
  'ok',
  'blocked_403',
  'not_image',
  'too_small',
  'too_large',
  'timeout',
  'face_detected',
] as const;

export type CheckMediaCode = (typeof CHECK_MEDIA_CODES)[number];

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
 * Upload one local image for a segment and return its mediaId.
 * Reads run the same stat-before-read, size-guard-before-and-after-read
 * pattern as the persona library uploads, with the 8MB engine photo
 * limit instead of the 10MB library limit. Only the mediaId reaches
 * tool output: the local path and the temp asset URL never do.
 */
export async function uploadSegmentMedia(
  client: PostEngineerClient,
  path: string,
): Promise<{ mediaId: string }> {
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
  return narrowUploadResult(result);
}

function narrowUploadResult(result: unknown): { mediaId: string } {
  if (typeof result !== 'object' || result === null) {
    throw new Error('The media upload endpoint returned an unexpected response.');
  }
  const record = result as Record<string, unknown>;
  if (record.success !== true || typeof record.mediaId !== 'string' || record.mediaId.length === 0) {
    throw new Error('The media upload endpoint returned an unexpected response.');
  }
  return { mediaId: record.mediaId };
}

/**
 * Mechanically check one image URL through the engine (no LLM, no
 * relevance judgement): the agent, who sees the image, decides
 * relevance. Returns exactly one code; the URL never reaches output.
 */
export async function checkSegmentMedia(
  client: PostEngineerClient,
  url: string,
): Promise<{ code: CheckMediaCode }> {
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
      body: JSON.stringify({ url }),
    },
    'check segment media',
  );
  return narrowCheckResult(result);
}

function narrowCheckResult(result: unknown): { code: CheckMediaCode } {
  if (typeof result !== 'object' || result === null) {
    throw new Error('The media check endpoint returned an unexpected response.');
  }
  const record = result as Record<string, unknown>;
  if (record.success !== true || typeof record.code !== 'string') {
    throw new Error('The media check endpoint returned an unexpected response.');
  }
  if (!(CHECK_MEDIA_CODES as ReadonlyArray<string>).includes(record.code)) {
    throw new Error('The media check endpoint returned an unknown code.');
  }
  return { code: record.code as CheckMediaCode };
}
