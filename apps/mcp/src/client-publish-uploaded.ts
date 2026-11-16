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
import {
  MintVideoUploadBodySchema,
  completeVideoUpload as completeVideoUploadContract,
  mintVideoUpload as mintVideoUploadContract,
  publishUploadedVideo as publishUploadedVideoContract,
} from './contracts/videos.js';
import { buildDirectPublishForm, requireDirectPublishFields } from './direct-publish-form.js';
import { narrowDirectPublishAccountResult } from './direct-publish-narrowing.js';
import { getErrorMessage, VideoTooLargeError } from './errors.js';
import { DIRECT_PUBLISH_TIMEOUT_MS, MAX_UPLOAD_VIDEO_BYTES } from './limits.js';
import { isSocialProvider, SOCIAL_PROVIDERS } from './contracts/providers.js';

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

export async function createVideoUpload(
  client: PostEngineerClient,
  input: { contentType: string; sizeBytes: number },
): Promise<MintedVideoUpload> {
  // The contract body schema carries the per-type ceiling (8 MB for an
  // image, 2GB for a video): fail fast with the route's own message.
  const body = MintVideoUploadBodySchema.safeParse(input);
  if (!body.success) {
    throw new Error(body.error.issues[0]?.message ?? 'Invalid upload request.');
  }
  const raw = await client.request(
    '/api/videos/upload-url',
    {
      method: 'POST',
      headers: client.getHeaders(),
      body: JSON.stringify({ contentType: input.contentType, sizeBytes: input.sizeBytes }),
    },
    'create video upload',
  );
  const parsed = parseContractResponse(mintVideoUploadContract, raw);
  return {
    uploadId: parsed.uploadId,
    signedUrl: parsed.signedUrl,
    token: parsed.token,
    expiresAt: parsed.expiresAt,
    maxBytes: parsed.maxBytes,
  };
}

export async function completeVideoUpload(
  client: PostEngineerClient,
  uploadId: string,
): Promise<CompletedVideoUpload> {
  if (uploadId.trim().length === 0) {
    throw new Error('uploadId is required.');
  }
  const raw = await client.request(
    `/api/videos/uploads/${encodeURIComponent(uploadId)}/complete`,
    { method: 'POST', headers: client.getHeaders(), body: JSON.stringify({}) },
    'complete video upload',
    UPLOAD_TIMEOUT_MS,
  );
  return parseContractResponse(completeVideoUploadContract, raw);
}

export async function publishUploadedVideo(
  client: PostEngineerClient,
  input: PublishUploadedVideoInput,
): Promise<DirectPublishResult> {
  // Mirrors the server-side 400s before any fetch: provider-specific
  // required fields fail fast here, exactly like publishVideoDirect.
  if (!isSocialProvider(input.provider)) {
    throw new Error(`provider must be one of: ${SOCIAL_PROVIDERS.join(', ')}.`);
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

  const raw: unknown = await client.request(
    '/api/videos/publish-by-id',
    { method: 'POST', headers: client.getHeaders(), body: JSON.stringify(body) },
    'publish uploaded video',
    UPLOAD_TIMEOUT_MS,
  );
  // A 200 with a malformed body is an error, never a silent success: the
  // agent must not report "published" on a body it can't read. The
  // contract keeps the lenient defaults of the old narrowing (provider
  // 'unknown', successCount 0, logId '') for fields the handlers omit.
  const parsed = parseContractResponse(publishUploadedVideoContract, raw);
  return {
    success: parsed.success,
    provider: parsed.provider ?? 'unknown',
    results: parsed.results.map(narrowDirectPublishAccountResult),
    successCount: parsed.successCount ?? 0,
    logId: parsed.logId ?? '',
  };
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
  if (!isSocialProvider(input.provider)) {
    throw new Error(`provider must be one of: ${SOCIAL_PROVIDERS.join(', ')}.`);
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
    { method: 'POST', headers: client.getHeaders(false), body: formData },
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
