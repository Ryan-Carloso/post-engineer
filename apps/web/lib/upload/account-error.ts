import { BlueskyError } from '@/lib/bluesky';
import { AccountNotFoundError, AuthError } from '@/lib/errors';
import { httpStatusOf } from './account-unauthorized';
import type { UploadAccountErrorCode } from './account-error-codes';

//---------------
// account-error — stable code for one account's upload failure (issue #500).
// The handler owns the classification and the engine trusts the code:
//   - user codes fail the account once and tell the user only they can fix it;
//   - transient (network, 408/429/5xx, rate limit) is retried by the engine;
//   - publish_rejected (any other 4xx, bad input) fails once, no user copy.
// The code comes from a typed error or the HTTP status, never from the text.
// The English sentence stays in `error` for logs.
//---------------

// Mirrors engine upload_publisher.RETRYABLE_STATUS_CODES (sync-tested).
export const TRANSIENT_HTTP_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

export function classifyUploadAccountError(
  error: unknown,
  code?: UploadAccountErrorCode,
): { error: string; errorCode: UploadAccountErrorCode } {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : 'Unknown error';
  return { error: message, errorCode: code ?? codeForError(error) };
}

export function accountFailure(
  accountId: string,
  error: unknown,
  code?: UploadAccountErrorCode,
): { accountId: string; success: false; error: string; errorCode: UploadAccountErrorCode } {
  return { accountId, success: false, ...classifyUploadAccountError(error, code) };
}

function codeForError(error: unknown): UploadAccountErrorCode {
  if (error instanceof AccountNotFoundError) return 'disconnected';
  if (error instanceof AuthError) {
    return error.authType === 'account_not_found' ? 'disconnected' : 'token_expired';
  }
  if (error instanceof BlueskyError) {
    if (error.code === 'email_not_verified') return 'email_not_verified';
    if (error.code === 'invalid_credentials') return 'token_expired';
    if (error.code === 'rate_limited') return 'transient';
  }
  return codeForStatus(httpStatusOf(error));
}

function codeForStatus(status: number | undefined): UploadAccountErrorCode {
  // No status: a network error or an unknown throw. Retry it; the engine
  // caps the account at 3 tries.
  if (status === undefined) return 'transient';
  if (status === 401) return 'token_expired';
  if (TRANSIENT_HTTP_STATUSES.has(status)) return 'transient';
  if (status >= 400 && status < 500) return 'publish_rejected';
  return 'transient';
}
