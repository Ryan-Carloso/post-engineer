import type { PostEngineerClient } from './client.js';
import type {
  CompletedVideoUpload,
  DirectPublishAccountResult,
  DirectPublishResult,
  MintedVideoUpload,
  PublishUploadedVideoInput,
} from './client-types.js';
import { requireDirectPublishFields } from './direct-publish-form.js';
import { MAX_UPLOAD_VIDEO_BYTES } from './limits.js';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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

function narrowDirectPublishAccountResult(value: unknown): DirectPublishAccountResult {
  if (!isRecord(value) || typeof value.accountId !== 'string' || typeof value.success !== 'boolean') {
    throw new Error('Malformed direct-publish account result from the API.');
  }
  const result: DirectPublishAccountResult = { accountId: value.accountId, success: value.success };
  if (typeof value.videoId === 'string') result.videoId = value.videoId;
  if (typeof value.videoUrl === 'string') result.videoUrl = value.videoUrl;
  if (typeof value.postId === 'string') result.postId = value.postId;
  if (typeof value.permalink === 'string') result.permalink = value.permalink;
  if (typeof value.error === 'string') result.error = value.error;
  return result;
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
