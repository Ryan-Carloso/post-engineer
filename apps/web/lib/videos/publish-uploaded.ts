import 'server-only';

import { ValidationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { isSocialProvider, type SocialProvider } from '@/lib/providers/registry';
import { handleBlueskyUpload, handleInstagramUpload, handleYoutubeUpload } from '@/lib/upload/handlers';
import { handleFacebookUpload } from '@/lib/upload/facebook-handler';
import { handleFanvueUpload } from '@/lib/upload/fanvue-handler';
import { handleLinkedinUpload } from '@/lib/upload/linkedin-handler';
import { handlePinterestUpload } from '@/lib/upload/pinterest-handler';
import { handleRumbleUpload } from '@/lib/upload/rumble-handler';
import { handleThreadsUpload } from '@/lib/upload/threads-handler';
import { handleThreespeakUpload } from '@/lib/upload/threespeak-handler';
import type { ContentUploadAccountResult } from '@/lib/upload/content-upload-result';
import {
  VideoUploadError,
  claimUploadForPublish,
  type VideoUploadStorage,
  type VideoUploadStore,
} from './signed-upload';

//---------------
// Publish-by-id (issue #561): publish a video that arrived through the
// signed-upload flow. The publish fields are validated BEFORE the upload
// is claimed, so a malformed publish never burns the single use; the
// claim itself is the atomic `ready` -> `consumed` update in
// signed-upload.ts. The provider dispatch reuses the exact handlers
// POST /api/upload-content uses — the only difference is where the
// bytes come from (storage, by id, instead of the multipart body).
//---------------

export interface PublishUploadedInput {
  uploadId: string;
  provider: SocialProvider;
  accountIds: string[];
  title?: string;
  description?: string;
  tags?: string[];
  privacyStatus?: string;
  caption?: string;
  boardId?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string.`, field);
  }
  return value;
}

export function parsePublishBody(body: unknown): PublishUploadedInput {
  if (!isRecord(body)) {
    throw new ValidationError('A JSON body with uploadId, provider and accountIds is required.', 'uploadId');
  }
  const uploadId = body.uploadId;
  if (typeof uploadId !== 'string' || !UUID_PATTERN.test(uploadId)) {
    throw new ValidationError('uploadId must be the id returned by the signed-upload mint step.', 'uploadId');
  }
  if (!isSocialProvider(body.provider)) {
    throw new ValidationError('provider is invalid.', 'provider');
  }
  const provider = body.provider;
  const rawIds = body.accountIds;
  if (
    !Array.isArray(rawIds) ||
    rawIds.length === 0 ||
    rawIds.some((id) => typeof id !== 'string' || id.trim() === '')
  ) {
    throw new ValidationError('At least one account ID is required.', 'accountIds');
  }
  const tags = body.tags;
  if (tags !== undefined && (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string'))) {
    throw new ValidationError('tags must be a list of strings.', 'tags');
  }
  const input: PublishUploadedInput = {
    uploadId,
    provider,
    accountIds: rawIds.map((id) => (id as string).trim()),
    title: optionalString(body, 'title'),
    description: optionalString(body, 'description'),
    tags: tags as string[] | undefined,
    privacyStatus: optionalString(body, 'privacyStatus'),
    caption: optionalString(body, 'caption'),
    boardId: optionalString(body, 'boardId'),
  };
  validatePublishFields(input);
  return input;
}

// Provider-specific required fields, checked before the claim (mirrors
// the MCP client's requireDirectPublishFields and the handlers' own
// validation, which still runs on the dispatched form).
export function validatePublishFields(input: PublishUploadedInput): void {
  if (input.provider === 'youtube' || input.provider === 'rumble' || input.provider === 'fanvue') {
    if (input.title === undefined || input.title.trim() === '') {
      throw new ValidationError('Video title is required', 'title');
    }
    if (input.description === undefined || input.description.trim() === '') {
      throw new ValidationError('Video description is required', 'description');
    }
    if (input.provider === 'youtube') {
      if (input.tags === undefined || input.tags.length === 0) {
        throw new ValidationError('Video tags are required', 'tags');
      }
      if (
        input.privacyStatus === undefined ||
        !['public', 'private', 'unlisted'].includes(input.privacyStatus)
      ) {
        throw new ValidationError('Invalid privacy status. Use "public", "private" or "unlisted"', 'privacyStatus');
      }
    }
    return;
  }
  if (input.provider === 'pinterest') {
    if (input.boardId === undefined || input.boardId.trim() === '') {
      throw new ValidationError('boardId is required for pinterest.', 'boardId');
    }
    const description = (input.description ?? '').trim() !== '' ? input.description : input.caption;
    if (description === undefined || description.trim() === '') {
      throw new ValidationError('description or caption is required for pinterest.', 'description');
    }
    return;
  }
  if (input.caption === undefined || input.caption.trim() === '') {
    throw new ValidationError('Caption is required', 'caption');
  }
}

const ACCOUNT_FIELD: Partial<Record<SocialProvider, string>> = {
  bluesky: 'did',
  linkedin: 'linkedinAccountIds',
  threads: 'threadsAccountIds',
  facebook: 'facebookAccountIds',
  pinterest: 'pinterestAccountIds',
  fanvue: 'fanvueAccountIds',
  '3speak': 'threespeakAccountIds',
  rumble: 'rumbleAccountIds',
};

export function buildPublishForm(
  input: PublishUploadedInput,
  buffer: Buffer,
  contentType: string,
): FormData {
  const extension = contentType === 'video/quicktime' ? 'mov' : 'mp4';
  const file = new File([new Uint8Array(buffer)], `upload.${extension}`, { type: contentType });
  const formData = new FormData();
  formData.append('provider', input.provider);
  if (input.provider === 'youtube') {
    formData.append('video', file);
    formData.append('title', (input.title ?? '').trim());
    formData.append('description', (input.description ?? '').trim());
    formData.append('tags', (input.tags ?? []).join(','));
    formData.append('privacyStatus', input.privacyStatus ?? '');
    for (const accountId of input.accountIds) formData.append('accountIds', accountId);
    return formData;
  }
  if (input.provider === 'instagram') {
    formData.append('file', file);
    formData.append('caption', (input.caption ?? '').trim());
    for (const accountId of input.accountIds) formData.append('igAccountIds', accountId);
    return formData;
  }
  formData.append('video', file);
  if (input.provider === 'rumble' || input.provider === 'fanvue') {
    formData.append('title', (input.title ?? '').trim());
    formData.append('description', (input.description ?? '').trim());
  } else {
    formData.append('caption', (input.caption ?? '').trim());
    if (input.provider === 'pinterest') {
      formData.append('title', (input.title ?? '').trim());
      const description =
        (input.description ?? '').trim() !== '' ? (input.description ?? '') : (input.caption ?? '');
      formData.append('description', description.trim());
      formData.append('boardId', (input.boardId ?? '').trim());
    }
  }
  const accountField = ACCOUNT_FIELD[input.provider] ?? 'accountIds';
  for (const accountId of input.accountIds) formData.append(accountField, accountId);
  return formData;
}

// The provider handlers each return their own response shape (all of
// them `{ success, results, ... }` with per-account entries). Normalize
// to the one publish-by-id contract the MCP client narrows.
export interface PublishUploadedResult {
  success: boolean;
  provider: SocialProvider;
  results: ContentUploadAccountResult[];
  logId: string;
}

function normalizePublishResponse(
  provider: SocialProvider,
  response: unknown,
  logId: string,
): PublishUploadedResult {
  if (!isRecord(response) || !Array.isArray(response.results)) {
    throw new Error(`The ${provider} publish handler returned a malformed response.`);
  }
  const results: ContentUploadAccountResult[] = [];
  for (const item of response.results as unknown[]) {
    if (!isRecord(item) || typeof item.accountId !== 'string' || typeof item.success !== 'boolean') {
      throw new Error(`The ${provider} publish handler returned a malformed account result.`);
    }
    const result: ContentUploadAccountResult = { accountId: item.accountId, success: item.success };
    if (typeof item.videoId === 'string') result.videoId = item.videoId;
    if (typeof item.videoUrl === 'string') result.videoUrl = item.videoUrl;
    if (typeof item.postId === 'string') result.postId = item.postId;
    if (typeof item.mediaId === 'string') result.mediaId = item.mediaId;
    if (typeof item.permalink === 'string') result.permalink = item.permalink;
    if (typeof item.error === 'string') result.error = item.error;
    results.push(result);
  }
  return {
    success: response.success === true,
    provider,
    results,
    logId: typeof response.logId === 'string' ? response.logId : logId,
  };
}

async function dispatchPublish(
  provider: SocialProvider,
  formData: FormData,
  userId: string,
  logId: string,
  startTime: number,
): Promise<PublishUploadedResult> {
  const response: unknown =
    provider === 'youtube'
      ? await handleYoutubeUpload(formData, userId, logId, startTime)
      : provider === 'instagram'
        ? await handleInstagramUpload(formData, userId, logId, startTime)
        : provider === 'bluesky'
          ? await handleBlueskyUpload(formData, userId)
          : provider === 'linkedin'
            ? await handleLinkedinUpload(formData, userId)
            : provider === 'threads'
              ? await handleThreadsUpload(formData, userId)
              : provider === 'facebook'
                ? await handleFacebookUpload(formData, userId)
                : provider === 'pinterest'
                  ? await handlePinterestUpload(formData, userId)
                  : provider === 'fanvue'
                    ? await handleFanvueUpload(formData, userId)
                    : provider === '3speak'
                      ? await handleThreespeakUpload(formData, userId)
                      : await handleRumbleUpload(formData, userId);
  return normalizePublishResponse(provider, response, logId);
}

export async function publishUploadedVideo(
  store: VideoUploadStore,
  storage: VideoUploadStorage,
  userId: string,
  input: PublishUploadedInput,
  logId: string,
  startTime: number,
  now: Date,
): Promise<PublishUploadedResult> {
  const claimed = await claimUploadForPublish(store, storage, userId, input.uploadId, now);
  const formData = buildPublishForm(input, claimed.buffer, claimed.contentType);
  try {
    return await dispatchPublish(input.provider, formData, userId, logId, startTime);
  } finally {
    // The upload is consumed either way; removing the object is
    // best-effort cleanup, never a publish failure.
    void storage.remove([claimed.row.storage_path]).catch(() => undefined);
    logger.info('[publish-by-id] upload consumed', {
      logId,
      metadata: { uploadId: input.uploadId, provider: input.provider },
    });
  }
}

export { VideoUploadError };
