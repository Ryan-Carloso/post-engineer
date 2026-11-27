import 'server-only';

import { ValidationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { isSocialProvider, type SocialProvider } from '@/lib/providers/registry';
import { PUBLISH_ACCOUNT_FIELDS, isTitleProvider } from '@/lib/contracts/providers';
import { checkFirstComment } from '@/lib/contracts/first-comment';
import { appendFirstComment, narrowFirstCommentWarnings } from '@/lib/first-comment/form-field';
import { PUBLISH_HANDLERS } from '@/lib/upload/publish-handlers';
import type { ContentUploadAccountResult } from '@/lib/upload/content-upload-result';
import {
  claimUploadForPublish,
  type VideoUploadStorage,
  type VideoUploadStore,
} from './signed-upload';

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
  firstComment?: string;
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
  const firstComment = checkFirstComment(body.firstComment);
  if (!firstComment.ok) throw new ValidationError(firstComment.error, 'firstComment');
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
    ...(firstComment.value === null ? {} : { firstComment: firstComment.value }),
  };
  validatePublishFields(input);
  return input;
}

function validatePublishFields(input: PublishUploadedInput): void {
  if (isTitleProvider(input.provider)) {
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

export function buildPublishForm(
  input: PublishUploadedInput,
  buffer: Buffer,
  contentType: string,
): FormData {
  const extension = contentType === 'video/quicktime' ? 'mov' : 'mp4';
  const file = new File([new Uint8Array(buffer)], `upload.${extension}`, { type: contentType });
  const formData = new FormData();
  formData.append('provider', input.provider);
  appendFirstComment(formData, input.provider, input.firstComment);
  if (input.provider === 'youtube') {
    formData.append('video', file);
    formData.append('title', (input.title ?? '').trim());
    formData.append('description', (input.description ?? '').trim());
    formData.append('tags', (input.tags ?? []).join(','));
    formData.append('privacyStatus', input.privacyStatus ?? '');
    for (const accountId of input.accountIds) formData.append(PUBLISH_ACCOUNT_FIELDS.youtube, accountId);
    return formData;
  }
  if (input.provider === 'instagram') {
    formData.append('file', file);
    formData.append('caption', (input.caption ?? '').trim());
    for (const accountId of input.accountIds) formData.append(PUBLISH_ACCOUNT_FIELDS.instagram, accountId);
    return formData;
  }
  formData.append('video', file);
  if (isTitleProvider(input.provider)) {
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
  for (const accountId of input.accountIds) formData.append(PUBLISH_ACCOUNT_FIELDS[input.provider], accountId);
  return formData;
}

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
    const warnings = narrowFirstCommentWarnings(item.warnings);
    if (warnings.length > 0) result.warnings = warnings;
    results.push(result);
  }
  return {
    success: response.success === true,
    provider,
    results,
    logId: typeof response.logId === 'string' ? response.logId : logId,
  };
}

export async function dispatchPublish(
  provider: SocialProvider,
  formData: FormData,
  userId: string,
  logId: string,
  startTime: number,
): Promise<PublishUploadedResult> {
  const response: unknown = await PUBLISH_HANDLERS[provider](formData, userId, logId, startTime);
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
  const claimed = await claimUploadForPublish(store, storage, userId, input.uploadId, now, [input.provider]);
  const formData = buildPublishForm(input, claimed.buffer, claimed.contentType);
  try {
    return await dispatchPublish(input.provider, formData, userId, logId, startTime);
  } finally {
    void storage.remove([claimed.row.storage_path]).catch(() => undefined);
    logger.info('[publish-by-id] upload consumed', {
      logId,
      metadata: { uploadId: input.uploadId, provider: input.provider },
    });
  }
}
