//---------------
// error-codes — central stable error codes for API, MCP and UI.
//
// Every user-facing failure from the generate-and-schedule flow (and, over
// time, the rest of the API) returns { success: false, error, code, field?, errorId }.
// Codes are stable machine-readable strings; `error` is the default
// human-readable message (templates use {placeholders} filled by
// formatErrorMessage). API, MCP and UI share these codes so agents and
// frontends can react programmatically instead of parsing copy.
//---------------

export const ERROR_CODES = {
  PERSONA_NOT_FOUND: 'PERSONA_NOT_FOUND',
  PERSONA_ACCESS_DENIED: 'PERSONA_ACCESS_DENIED',
  PERSONA_SCOPE_DENIED: 'PERSONA_SCOPE_DENIED',
  SOCIAL_ACCOUNT_NOT_OWNED: 'SOCIAL_ACCOUNT_NOT_OWNED',
  INVALID_PROVIDER_ACCOUNT: 'INVALID_PROVIDER_ACCOUNT',
  NO_CONNECTED_ACCOUNTS: 'NO_CONNECTED_ACCOUNTS',
  TOPICS_REQUIRED: 'TOPICS_REQUIRED',
  TOPICS_LIMIT_EXCEEDED: 'TOPICS_LIMIT_EXCEEDED',
  INVALID_SCHEDULE_TIME: 'INVALID_SCHEDULE_TIME',
  SCHEDULE_OUT_OF_RANGE: 'SCHEDULE_OUT_OF_RANGE',
  INSUFFICIENT_TOKENS: 'INSUFFICIENT_TOKENS',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  ENGINE_UNAVAILABLE: 'ENGINE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  PERSONA_NOT_FOUND: 'Persona does not exist or is not accessible.',
  PERSONA_ACCESS_DENIED: 'You do not have access to this persona.',
  PERSONA_SCOPE_DENIED: 'This API key cannot access the selected persona.',
  SOCIAL_ACCOUNT_NOT_OWNED: 'Selected {provider} account does not belong to this user.',
  INVALID_PROVIDER_ACCOUNT: 'Selected account cannot be used with this provider.',
  NO_CONNECTED_ACCOUNTS: 'No connected {provider} account found.',
  TOPICS_REQUIRED: 'At least one video idea is required.',
  TOPICS_LIMIT_EXCEEDED: 'You can generate up to 10 videos per request.',
  INVALID_SCHEDULE_TIME: 'One or more publishing times are invalid.',
  SCHEDULE_OUT_OF_RANGE: 'Publishing must be scheduled between 3 hours and 30 days from now.',
  INSUFFICIENT_TOKENS: 'You need {need} tokens, but only have {have}.',
  RATE_LIMIT_EXCEEDED: 'Too many video generation requests. Please try again later.',
  VALIDATION_FAILED: 'Request validation failed.',
  // Never leak internals: unexpected failures get this safe message; the
  // technical detail goes to server logs (and errorId) only.
  INTERNAL_ERROR: 'Something went wrong. Please try again later.',
  ENGINE_UNAVAILABLE: 'Video generation is temporarily unavailable. Please try again later.',
};

/** Default human-readable message for a code. */
export function errorMessage(code: ErrorCode): string {
  return DEFAULT_MESSAGES[code];
}

/**
 * Fill {placeholders} in the default message. Unknown placeholders are left
 * untouched so a missing param never produces a broken sentence.
 */
export function formatErrorMessage(
  code: ErrorCode,
  params?: Record<string, string | number>,
): string {
  let message = DEFAULT_MESSAGES[code];
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      // split/join instead of replaceAll: the tsconfig lib target predates es2021.
      message = message.split(`{${key}}`).join(String(value));
    }
  }
  return message;
}

/** Type guard for values arriving from untyped boundaries (MCP, UI). */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (Object.values(ERROR_CODES) as string[]).includes(value);
}
