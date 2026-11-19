import { BlueskyError } from '@/lib/bluesky';
import { AccountNotFoundError, AuthError } from '@/lib/errors';
import { httpStatusOf, isMetaInvalidToken } from './account-unauthorized';
import type { UploadAccountErrorCode } from './account-error-codes';

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
  if (isMetaInvalidToken(error)) return 'token_expired';
  return codeForStatus(httpStatusOf(error));
}

function codeForStatus(status: number | undefined): UploadAccountErrorCode {
  if (status === undefined) return 'transient';
  if (status === 401) return 'token_expired';
  if (TRANSIENT_HTTP_STATUSES.has(status)) return 'transient';
  if (status >= 400 && status < 500) return 'publish_rejected';
  return 'transient';
}
