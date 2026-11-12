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

export type UploadAccountErrorCode = UserAccountErrorCode | 'transient' | 'publish_rejected' | 'publish_in_progress';

// 'publish_in_progress' is not a failure: the web route is still
// publishing this account under an earlier request (the first attempt
// outlived the engine's 600s timeout). The engine waits 60s and re-asks
// for the recorded result instead of spending one of its 3 tries —
// it is not a user code, and it never carries a user notice.

export function isUserAccountErrorCode(code: string): code is UserAccountErrorCode {
  return USER_ACCOUNT_ERROR_CODES.some((known) => known === code);
}
