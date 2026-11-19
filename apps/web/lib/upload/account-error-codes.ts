export const USER_ACCOUNT_ERROR_CODES = [
  'email_not_verified',
  'token_expired',
  'token_missing',
  'disconnected',
] as const;

export type UserAccountErrorCode = (typeof USER_ACCOUNT_ERROR_CODES)[number];

export type UploadAccountErrorCode = UserAccountErrorCode | 'transient' | 'publish_rejected' | 'publish_in_progress' | 'publish_unknown';

export function isUserAccountErrorCode(code: string): code is UserAccountErrorCode {
  return USER_ACCOUNT_ERROR_CODES.some((known) => known === code);
}
