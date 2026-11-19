import type { DirectPublishAccountResult } from './client-types.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function narrowDirectPublishAccountResult(value: unknown): DirectPublishAccountResult {
  if (!isRecord(value) || typeof value.accountId !== 'string' || typeof value.success !== 'boolean') {
    throw new Error('Malformed direct-publish account result from the API.');
  }
  const result: DirectPublishAccountResult = {
    accountId: value.accountId,
    success: value.success,
  };
  if (typeof value.videoId === 'string') result.videoId = value.videoId;
  if (typeof value.videoUrl === 'string') result.videoUrl = value.videoUrl;
  if (typeof value.postId === 'string') result.postId = value.postId;
  if (typeof value.permalink === 'string') result.permalink = value.permalink;
  if (typeof value.error === 'string') result.error = value.error;
  if (typeof value.errorCode === 'string') result.errorCode = value.errorCode;
  return result;
}
