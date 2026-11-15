import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { PostEngineerClient } from './client.js';
import type {
  CompletedVideoUpload,
  DirectPublishResult,
  MintedVideoUpload,
  PublishUploadedVideoInput,
  PublishVideoDirectInput,
} from './client-types.js';
import { parseContractResponse } from './contract-response.js';
import { uploadContent as uploadContentContract } from './contracts/media.js';
import { buildDirectPublishForm, requireDirectPublishFields } from './direct-publish-form.js';
import { isRecord, narrowDirectPublishAccountResult } from './direct-publish-narrowing.js';
import { getErrorMessage, VideoTooLargeError } from './errors.js';
import { DIRECT_PUBLISH_TIMEOUT_MS, MAX_UPLOAD_VIDEO_BYTES } from './limits.js';

//---------------
// Signed-upload publish client calls (issue #561). Standalone functions
// (not client methods) because client.ts is grandfathered over the
// 500-line cap and may not grow — the same pattern as
// client-user-media.ts. Flow: createVideoUpload mints a signed URL,
// the caller PUTs the video bytes to it directly (never through this
// server), completeVideoUpload asks the web app to verify the stored
// bytes, and publishUploadedVideo publishes by id. JSON only: no local
// path ever crosses this surface.
//---------------

const UPLOAD_TIMEOUT_MS = 120_000;
const VIDEO_CONTENT_TYPES = ['video/mp4', 'video/quicktime'];

export async function createVideoUpload(
  client: PostEngineerClient,
  input: { contentType: string; sizeBytes: number },
): Promise<MintedVideoUpload> {
  if (!VIDEO_CONTENT_TYPES.includes(input.contentType)) {
    throw new Error('contentType must be video/mp4 or video/quicktime.');
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_UPLOAD_VIDEO_BYTES) {
    throw new Error('sizeBytes must be an integer between 1 and the 2GB video limit.');
  }
  const result = await client.request(
    '/api/videos/upload-url',
    {
      method: 'POST',
      headers: client.getHeaders(),
      body: JSON.stringify({ contentType: input.contentType, sizeBytes: input.sizeBytes }),
    },
    'create video upload',
  );
  if (
    !isRecord(result) ||
    typeof result.uploadId !== 'string' ||
    typeof result.signedUrl !== 'string' ||
    typeof result.token !== 'string' ||
    typeof result.expiresAt !== 'string' ||
    typeof result.maxBytes !== 'number'
  ) {
    throw new Error('Malformed signed-upload response from the API.');
  }
  return {
    uploadId: result.uploadId,
    signedUrl: result.signedUrl,
    token: result.token,
    expiresAt: result.expiresAt,
    maxBytes: result.maxBytes,
  };
}

export async function completeVideoUpload(
  client: PostEngineerClient,
  uploadId: string,
): Promise<CompletedVideoUpload> {
  if (uploadId.trim().length === 0) {
    throw new Error('uploadId is required.');
  }
  const result = await client.request(
    `/api/videos/uploads/${encodeURIComponent(uploadId)}/complete`,
    { method: 'POST', headers: client.getHeaders(), body: JSON.stringify({}) },
    'complete video upload',
    UPLOAD_TIMEOUT_MS,
  );
  if (
    !isRecord(result) ||
    typeof result.uploadId !== 'string' ||
    result.status !== 'ready' ||
    typeof result.contentType !== 'string' ||
    typeof result.sizeBytes !== 'number'
  ) {
    throw new Error('Malformed complete-upload response from the API.');
  }
  return {
    uploadId: result.uploadId,
    status: 'ready',
    contentType: result.contentType,
    sizeBytes: result.sizeBytes,
  };
}

// A 200 with a malformed body is an error, never a silent success: the
// agent must not report "published" on a body it can't read.
function narrowDirectPublishResult(value: unknown): DirectPublishResult {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    throw new Error('Malformed direct-publish response from the API.');
  }
  return {
    success: value.success === true,
    provider: typeof value.provider === 'string' ? value.provider : 'unknown',
    results: value.results.map(narrowDirectPublishAccountResult),
    successCount: typeof value.successCount === 'number' ? value.successCount : 0,
    logId: typeof value.logId === 'string' ? value.logId : '',
  };
}

export async function publishUploadedVideo(
  client: PostEngineerClient,
  input: PublishUploadedVideoInput,
): Promise<DirectPublishResult> {
  // Mirrors the server-side 400s before any fetch: provider-specific
  // required fields fail fast here, exactly like publishVideoDirect.
  const validProviders = ['youtube', 'instagram', 'linkedin', 'bluesky', 'threads', 'facebook', 'pinterest', 'fanvue', '3speak', 'rumble'];
  if (!validProviders.includes(input.provider)) {
    throw new Error(`provider must be one of: ${validProviders.join(', ')}.`);
  }
  if (input.uploadId.trim().length === 0) {
    throw new Error('uploadId is required.');
  }
  if (input.accountIds.length === 0) {
    throw new Error('At least one account ID is required.');
  }
  const fields = requireDirectPublishFields(input);
  const body: Record<string, unknown> = {
    uploadId: input.uploadId,
    provider: input.provider,
    accountIds: input.accountIds,
  };
  if (fields.title !== '') body.title = fields.title;
  if (fields.description !== '') body.description = fields.description;
  if (fields.caption !== '') body.caption = fields.caption;
  if (fields.boardId !== '') body.boardId = fields.boardId;
  if (fields.tags.length > 0) body.tags = fields.tags;
  if (fields.privacyStatus !== '') body.privacyStatus = fields.privacyStatus;

  const result: unknown = await client.request(
    '/api/videos/publish-by-id',
    { method: 'POST', headers: client.getHeaders(), body: JSON.stringify(body) },
    'publish uploaded video',
    UPLOAD_TIMEOUT_MS,
  );
  return narrowDirectPublishResult(result);
}

//---------------
// Direct publish of a user-provided video file (POST /api/upload-content).
// Moved out of client.ts (grandfathered over the 500-line cap) next to
// publishUploadedVideo, which shares the response shape.
//---------------

/**
 * Shared size guard for direct-publish videos: the server rejects anything
 * over 2GB, so fail fast locally before uploading gigabytes. Throws the
 * typed VideoTooLargeError carrying the full path.
 */
export function assertVideoSize(sizeBytes: number, path: string): void {
  if (sizeBytes > MAX_UPLOAD_VIDEO_BYTES) {
    throw new VideoTooLargeError(path, sizeBytes);
  }
}

function mimeTypeForVideoPath(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === '.mp4') return 'video/mp4';
  if (extension === '.mov') return 'video/quicktime';
  throw new Error(
    `Unsupported video extension "${extension || '(none)'}": use MP4 or MOV.`,
  );
}

async function videoFormFile(path: string): Promise<Blob> {
  // Validate before uploading: the API rejects the file anyway, so an
  // oversized or unsupported video fails fast locally instead of wasting an
  // upload. A stat() pre-check bounds memory before readFile — a multi-GB
  // file would otherwise load fully into this stdio process. The TOCTOU
  // window is benign: the authoritative size check still runs on the buffer.
  // Any failure surfaces with the full path for a consistent, actionable
  // message. The server re-validates content via magic bytes, so a
  // mislabeled file still fails server-side.
  const mimeType = mimeTypeForVideoPath(path);
  try {
    const fileStat = await stat(path);
    assertVideoSize(fileStat.size, path);
  } catch (error) {
    // Discriminate by type, not by message text: the typed size error
    // passes through untouched, while stat failures become the actionable
    // "Failed to read video" wrapper.
    if (error instanceof VideoTooLargeError) throw error;
    throw new Error(`Failed to read video "${path}": ${getErrorMessage(error)}`);
  }
  let buffer: Buffer;
  try {
    buffer = await readFile(path);
  } catch (error) {
    throw new Error(`Failed to read video "${path}": ${getErrorMessage(error)}`);
  }
  if (buffer.length === 0) {
    throw new Error(`Video "${path}" is empty.`);
  }
  // The post-read check reuses the shared guard: same limit, same message,
  // full path — and it covers the (benign) TOCTOU window after stat.
  assertVideoSize(buffer.length, path);
  return new Blob([buffer], { type: mimeType });
}

export async function publishVideoDirect(
  client: PostEngineerClient,
  input: PublishVideoDirectInput,
): Promise<DirectPublishResult> {
  // Direct publish of a user-provided video — no generation, no schedule.
  // Mirrors the server-side 400s: provider-specific required fields and
  // per-provider account-id field names fail fast here, before any fetch.
  const validProviders = ['youtube', 'instagram', 'linkedin', 'bluesky', 'threads', 'facebook', 'pinterest', 'fanvue', '3speak', 'rumble'];
  if (!validProviders.includes(input.provider)) {
    throw new Error(`provider must be one of: ${validProviders.join(', ')}.`);
  }
  if (input.accountIds.length === 0) {
    throw new Error('At least one account ID is required.');
  }
  const fields = requireDirectPublishFields(input);
  const videoBlob = await videoFormFile(input.videoPath);
  const filename = basename(input.videoPath);
  const formData = buildDirectPublishForm(input, fields, videoBlob, filename);

  const result: unknown = await client.request(
    '/api/upload-content',
    { method: 'POST', headers: client.getHeaders(), body: formData },
    'publish video direct',
    DIRECT_PUBLISH_TIMEOUT_MS,
  );
  // A 200 with a malformed body is an error, never a silent success: the
  // agent must not report "published" on a body it can't read. The
  // contract keeps the lenient defaults of the old narrowing (provider
  // 'unknown', successCount 0, logId '') for fields the handlers omit.
  const parsed = parseContractResponse(uploadContentContract, result);
  return {
    success: parsed.success,
    provider: parsed.provider ?? 'unknown',
    results: parsed.results.map(narrowDirectPublishAccountResult),
    successCount: parsed.successCount ?? 0,
    logId: parsed.logId ?? '',
  };
}
