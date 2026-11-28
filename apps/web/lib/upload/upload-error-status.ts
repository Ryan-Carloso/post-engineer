import { AuthError, InstagramApiError, ValidationError } from '@/lib/errors';
import { TRANSIENT_HTTP_STATUSES } from '@/lib/upload/account-error';
import type { UploadAccountErrorCode } from '@/lib/upload/account-error-codes';

export function uploadErrorStatus(error: unknown): number {
  if (error instanceof ValidationError) return 400;
  if (error instanceof InstagramApiError) return error.statusCode || 500;
  if (error instanceof AuthError) return 401;
  return 500;
}

export function uploadRejectionCode(status: number): UploadAccountErrorCode {
  if (status === 401 || status === 403) return 'disconnected';
  if (TRANSIENT_HTTP_STATUSES.has(status)) return 'transient';
  if (status >= 400 && status < 500) return 'publish_rejected';
  return 'transient';
}
