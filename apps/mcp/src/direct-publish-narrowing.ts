import type { DirectPublishAccountResult } from './client-types.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// Narrow one per-account outcome from POST /api/upload-content. Every
// optional field the API can return must be passed through: the tool
// descriptions tell the agent to act on errorCode (publish_unknown means
// the post may already be live but its record was lost — do not retry),
// so dropping it here would hide the signal the docs promise.
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
