import { basename, extname } from 'node:path';
import { readBoundedRegularFile } from './bounded-file-read.js';
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

const UPLOAD_TIMEOUT_MS = 120_000;

export async function createVideoUpload(
  client: PostEngineerClient,
  input: { contentType: string; sizeBytes: number },
): Promise<MintedVideoUpload> {
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
  const parsed = parseContractResponse(publishUploadedVideoContract, raw);
  return {
    success: parsed.success,
    provider: parsed.provider ?? 'unknown',
    results: parsed.results.map(narrowDirectPublishAccountResult),
    successCount: parsed.successCount ?? 0,
    logId: parsed.logId ?? '',
  };
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
  const mimeType = mimeTypeForVideoPath(path);
  let read;
  try {
    read = await readBoundedRegularFile(path, MAX_UPLOAD_VIDEO_BYTES);
  } catch (error) {
    throw new Error(`Failed to read video "${path}": ${getErrorMessage(error)}`);
  }
  if (read.status === 'not-file') throw new Error(`Video "${path}" is not a regular file.`);
  if (read.status === 'too-large') throw new VideoTooLargeError(path, read.sizeBytes);
  if (read.buffer.length === 0) {
    throw new Error(`Video "${path}" is empty.`);
  }
  return new Blob([read.buffer], { type: mimeType });
}

export async function publishVideoDirect(
  client: PostEngineerClient,
  input: PublishVideoDirectInput,
): Promise<DirectPublishResult> {
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
  const parsed = parseContractResponse(uploadContentContract, result);
  return {
    success: parsed.success,
    provider: parsed.provider ?? 'unknown',
    results: parsed.results.map(narrowDirectPublishAccountResult),
    successCount: parsed.successCount ?? 0,
    logId: parsed.logId ?? '',
  };
}
