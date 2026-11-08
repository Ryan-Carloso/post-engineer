//---------------
// account-error — stable code for one account's upload failure (issue #500).
// The engine classifies from errorCode first. The English sentence stays in
// `error` for logs. User-account codes fail once and tell the user only they
// can fix it. Anything else is publish_rejected (also terminal) unless the
// engine later treats the HTTP status as transient.
//---------------

export const USER_ACCOUNT_ERROR_CODES = [
  'email_not_verified',
  'token_expired',
  'token_missing',
  'disconnected',
] as const;

export type UploadAccountErrorCode =
  | (typeof USER_ACCOUNT_ERROR_CODES)[number]
  | 'publish_rejected';

export function classifyUploadAccountError(error: unknown): {
  error: string;
  errorCode: UploadAccountErrorCode;
} {
  const code = readCode(error);
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : 'Unknown error';
  if (code === 'email_not_verified') {
    return { error: message, errorCode: 'email_not_verified' };
  }
  return { error: message, errorCode: codeForMessage(message) };
}

export function accountFailure(
  accountId: string,
  error: unknown,
): { accountId: string; success: false; error: string; errorCode: UploadAccountErrorCode } {
  const classified = classifyUploadAccountError(error);
  return { accountId, success: false, ...classified };
}

function readCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function codeForMessage(message: string): UploadAccountErrorCode {
  const text = message.toLowerCase();
  if (text.includes('email') && text.includes('not verified')) return 'email_not_verified';
  if (text.includes('expired') || text.includes('reconnect')) return 'token_expired';
  if (text.includes('not found') || text.includes('credential')) return 'token_missing';
  if (text.includes('disconnected') || text.includes('unauthorized')) return 'disconnected';
  return 'publish_rejected';
}
