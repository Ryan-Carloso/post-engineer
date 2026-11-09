//---------------
// account-error-codes — the per-account publish failure codes (issue #500).
// Dependency-free so client components can import the list. The engine keeps
// the same user codes in fill_schedule/account_outcomes.py (sync-tested).
//---------------

export const USER_ACCOUNT_ERROR_CODES = [
  'email_not_verified',
  'token_expired',
  'token_missing',
  'disconnected',
] as const;

export type UserAccountErrorCode = (typeof USER_ACCOUNT_ERROR_CODES)[number];

export type UploadAccountErrorCode = UserAccountErrorCode | 'transient' | 'publish_rejected';

export function isUserAccountErrorCode(code: string): code is UserAccountErrorCode {
  return USER_ACCOUNT_ERROR_CODES.some((known) => known === code);
}
